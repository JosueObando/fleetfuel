import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * `intentos_login` contra un Postgres real.
 *
 * Es la única tabla del esquema SIN RLS, y eso no se puede probar con un doble:
 * lo que se está fijando son privilegios y políticas del motor. Las dos cosas
 * que aquí se afirman son decisiones deliberadas que, si alguien las deshace
 * sin querer, no dan ningún error —sólo cambian en silencio quién puede leer
 * qué—:
 *
 *   1. Se puede INSERTAR sin empresa y sin usuario. Es el caso que motiva la
 *      tabla: un intento contra un correo que no existe.
 *   2. El rol de la aplicación puede INSERTAR y NO puede leer, ni modificar,
 *      ni borrar.
 */

const comun = {
  type: 'postgres' as const,
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5433', 10),
  database: process.env.DATABASE_NAME || 'fleetfuel_db',
};

const dueño = new DataSource({
  ...comun,
  username: process.env.DATABASE_USER || 'fleetfuel_owner',
  password: process.env.DATABASE_PASSWORD || 'cambiar_en_produccion',
});
const app = new DataSource({
  ...comun,
  username: process.env.DATABASE_APP_USER || 'fleetfuel_app',
  password: process.env.DATABASE_APP_PASSWORD || 'cambiar_en_produccion_app',
});

const marca = `prueba-${process.pid}`;

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();
});

afterAll(async () => {
  if (dueño.isInitialized) {
    await dueño.query(`DELETE FROM intentos_login WHERE correo LIKE $1`, [`${marca}%`]);
    await dueño.destroy();
  }
  if (app.isInitialized) await app.destroy();
});

describe('forma de la tabla', () => {
  it('no tiene RLS, y es la única así', async () => {
    // Deliberado: no hay empresa por la que aislar cuando el correo no
    // resuelve. Si alguien le activara RLS «por coherencia», los intentos
    // contra correos inexistentes dejarían de poder escribirse.
    const [{ relrowsecurity: conRls }] = await dueño.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'intentos_login'`,
    );
    expect(conRls).toBe(false);
  });

  it('admite intentos sin empresa y sin usuario', async () => {
    // El caso que motiva toda la tabla. Con las columnas NOT NULL de
    // `auditoria` esto es literalmente imposible de escribir.
    await app.query(
      `INSERT INTO intentos_login (correo, motivo, ip) VALUES ($1, $2, $3::inet)`,
      [`${marca}-desconocido@ejemplo.test`, 'correo_desconocido', '203.0.113.7'],
    );
    const [fila] = await dueño.query(
      // `host()` y no `ip::text`: el cast a texto arrastra la máscara
      // (`203.0.113.7/32`) y la comparación fallaría por un detalle que no es
      // el que se está probando.
      `SELECT empresa_id, usuario_id, motivo, host(ip) AS ip FROM intentos_login WHERE correo = $1`,
      [`${marca}-desconocido@ejemplo.test`],
    );
    expect(fila.empresa_id).toBeNull();
    expect(fila.usuario_id).toBeNull();
    expect(fila.motivo).toBe('correo_desconocido');
    expect(fila.ip).toBe('203.0.113.7');
  });

  it('guarda el motivo real, no el mensaje genérico', async () => {
    // Hacia fuera «credenciales inválidas» tanto si el correo no existe como
    // si la clave está mal. Hacia dentro tienen que distinguirse: son ataques
    // distintos. Si esta distinción se perdiera, el registro existiría y no
    // serviría para nada.
    for (const motivo of ['clave_incorrecta', 'mfa_incorrecto', 'usuario_suspendido']) {
      await app.query(
        `INSERT INTO intentos_login (correo, motivo) VALUES ($1, $2)`,
        [`${marca}-${motivo}@ejemplo.test`, motivo],
      );
    }
    const filas = await dueño.query(
      `SELECT motivo FROM intentos_login WHERE correo LIKE $1 ORDER BY motivo`,
      [`${marca}-%`],
    );
    expect(filas.map((f: { motivo: string }) => f.motivo))
      .toEqual(expect.arrayContaining(['clave_incorrecta', 'mfa_incorrecto', 'usuario_suspendido']));
  });
});

describe('privilegios del rol de la aplicación', () => {
  it('puede insertar', async () => {
    await expect(app.query(
      `INSERT INTO intentos_login (correo, motivo) VALUES ($1, 'clave_incorrecta')`,
      [`${marca}-insertable@ejemplo.test`],
    )).resolves.toBeDefined();
  });

  it('NO puede leer', async () => {
    // Sin ruta de lectura no hay fuga entre empresas que discutir. El día que
    // exista una pantalla para esto habrá que dar el GRANT a conciencia, y esta
    // prueba fallará: es el recordatorio, no un estorbo.
    await expect(app.query(`SELECT * FROM intentos_login LIMIT 1`)).rejects.toThrow(/permission denied/i);
  });

  it('NO puede modificar ni borrar', async () => {
    // Que la aplicación no pueda borrar es la mitad del valor de tener el
    // registro: quien entre por el login no puede tapar sus propias huellas.
    await expect(app.query(`UPDATE intentos_login SET motivo = 'x'`)).rejects.toThrow(/permission denied/i);
    await expect(app.query(`DELETE FROM intentos_login`)).rejects.toThrow(/permission denied/i);
  });
});
