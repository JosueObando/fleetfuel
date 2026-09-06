import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Los intentos de inicio de sesión FALLIDOS, que hasta ahora no dejaban rastro.
 *
 * `registrarAcceso` sólo corre en el camino de éxito: todos los fallos lanzan
 * la excepción antes de llegar. El resultado era que se podía atacar el login
 * indefinidamente sin dejar una sola línea en ninguna parte — verificado el
 * 2026-09-06 con 42 intentos seguidos.
 *
 * POR QUÉ UNA TABLA APARTE Y NO `auditoria`
 *
 * Porque `auditoria.empresa_id` es NOT NULL y tiene RLS por `app.empresa_id`, y
 * un intento contra un correo que no existe NO PERTENECE A NINGUNA EMPRESA: no
 * hay valor correcto que poner. Y si se inventara uno, la RLS escondería
 * exactamente los intentos contra correos inexistentes — que es la señal más
 * interesante que hay aquí, la de alguien probando si `admin@` existe.
 *
 * Hay una segunda razón y es más de fondo: la auditoría se escribe DENTRO de la
 * transacción de la petición, para que el rastro se revierta si la operación
 * falla. Para un login fallido eso es justo al revés — el rastro tiene que
 * sobrevivir PRECISAMENTE PORQUE la operación falló.
 *
 * POR QUÉ NO LLEVA RLS
 *
 * Es la única tabla del esquema sin ella, y es deliberado: no hay empresa por
 * la que aislar cuando el correo no resuelve. A cambio, el rol de la aplicación
 * recibe INSERT y NO SELECT. Escribe y no lee nunca. Sin ruta de lectura no hay
 * fuga entre empresas que discutir, y la decisión de cómo se consulta —con qué
 * permiso y con qué visibilidad— queda para cuando exista la pantalla que la
 * necesite. Hoy se lee con `psql`, que es lo que hace un operador mirando un
 * ataque.
 */
export class IntentosLogin1790000000000 implements MigrationInterface {
  name = 'IntentosLogin1790000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE intentos_login (
        intento_id  bigserial PRIMARY KEY,
        -- Lo que se tecleó. En claro y no como huella: quien mira un ataque
        -- necesita ver CONTRA QUÉ va. El DTO ya lo validó como correo antes de
        -- llegar aquí, y de todas formas el ancho lo acota.
        correo      varchar(160),
        -- Los dos se rellenan SÓLO si el correo resolvió. Nulos significan
        -- «ese correo no existe», que es información, no un hueco.
        empresa_id  bigint REFERENCES empresas(empresa_id),
        usuario_id  bigint REFERENCES usuarios(usuario_id),
        motivo      varchar(40) NOT NULL,
        ip          inet,
        ocurrido_en timestamptz NOT NULL DEFAULT now()
      )`);

    // Las tres preguntas que se le hacen a esta tabla cuando algo huele mal:
    // qué ha pasado últimamente, contra qué cuenta, y desde qué dirección.
    await q.query(`CREATE INDEX ix_intentos_login_fecha ON intentos_login (ocurrido_en DESC)`);
    await q.query(`CREATE INDEX ix_intentos_login_correo ON intentos_login (lower(correo), ocurrido_en DESC)`);
    await q.query(`CREATE INDEX ix_intentos_login_ip ON intentos_login (ip, ocurrido_en DESC)`);

    const usuarioApp = process.env.DATABASE_APP_USER || 'fleetfuel_app';
    // INSERT y nada más. Ni SELECT, ni UPDATE, ni DELETE: es un registro
    // append-only que la aplicación no tiene ninguna razón para leer ni para
    // corregir. Que no pueda borrarlo es la mitad del valor de tenerlo.
    await q.query(`GRANT INSERT ON intentos_login TO ${usuarioApp}`);
    await q.query(`
      DO $$
      DECLARE secuencia text;
      BEGIN
        secuencia := pg_get_serial_sequence('intentos_login', 'intento_id');
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO %I', secuencia, '${usuarioApp}');
      END $$;`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS intentos_login CASCADE`);
  }
}
