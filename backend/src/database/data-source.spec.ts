import { AppDataSource } from './data-source';
import configuration from '../config/configuration';

/*
 * El ADR 003 se sostiene sobre una separación que no está escrita en ningún
 * sitio salvo en estos dos ficheros: las migraciones y las semillas se conectan
 * como DUEÑO del esquema, y la aplicación en caliente como un rol restringido.
 *
 * En Postgres el dueño de una tabla EVADE sus propias políticas RLS. Si la
 * aplicación se conectara con el usuario de aquí, el aislamiento entre empresas
 * dejaría de existir y ninguna prueba funcional lo notaría: todas las consultas
 * seguirían devolviendo los datos correctos, sólo que también los de las demás.
 *
 * Este fichero no tenía NINGUNA prueba —0 % de ramas— porque sólo lo importan
 * el CLI de TypeORM y la semilla. Lo que se fija aquí no es su configuración,
 * es que las dos conexiones no se confundan nunca.
 */

describe('AppDataSource · la conexión de dueño', () => {
  const opciones = AppDataSource.options as { username?: string; password?: string; synchronize?: boolean };

  it('usa el usuario dueño, no el de la aplicación', () => {
    expect(opciones.username).toBe(process.env.DATABASE_USER || 'fleetfuel_owner');
  });

  it('NO es el mismo usuario con el que se conecta la aplicación', () => {
    // La afirmación que de verdad protege la RLS. Comprobar cada uno por
    // separado contra su valor esperado no basta: el fallo que importa es que
    // ambos acaben siendo el mismo, y eso sólo se ve comparándolos.
    expect(opciones.username).not.toBe(configuration().database.user);
  });

  it('nunca sincroniza el esquema: las migraciones son la única vía', () => {
    // `synchronize: true` reescribiría las tablas según las entidades y se
    // llevaría por delante las políticas RLS, los índices parciales y los
    // permisos por rol, que viven en las migraciones y no en los decoradores.
    expect(opciones.synchronize).toBe(false);
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Los VALORES POR OMISIÓN, que es lo que se usa en un despliegue nuevo.
 *
 * Cada `||` de este fichero es una decisión sobre qué pasa cuando falta una
 * variable de entorno, y ese es exactamente el escenario de la primera vez que
 * alguien levanta el proyecto. Aquí las variables SIEMPRE están —`.env` las
 * carga—, así que la rama que corre en la máquina de quien acaba de clonar era
 * la única sin probar. Es el mismo motivo por el que se probaron los valores
 * por omisión de `configuration.ts`.
 *
 * El módulo se recarga porque `AppDataSource` se construye UNA vez al importar.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('sin variables de entorno · lo que ve quien acaba de clonar', () => {
  const VARIABLES = ['DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_NAME',
                     'DATABASE_USER', 'DATABASE_PASSWORD'] as const;
  const originales: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const v of VARIABLES) { originales[v] = process.env[v]; delete process.env[v]; }
  });
  afterEach(() => {
    for (const v of VARIABLES) {
      if (originales[v] === undefined) delete process.env[v];
      else process.env[v] = originales[v];
    }
    jest.resetModules();
  });

  it('cae a los valores del compose de desarrollo', async () => {
    await jest.isolateModulesAsync(async () => {
      // `dotenv` no pisa lo que ya está puesto, pero aquí NO hay nada puesto:
      // por eso hay que evitar que lo cargue del `.env` del repositorio.
      jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
      const { AppDataSource } = await import('./data-source');
      const o = AppDataSource.options as unknown as Record<string, unknown>;
      expect(o.host).toBe('localhost');
      expect(o.port).toBe(5433);
      expect(o.database).toBe('fleetfuel_db');
      expect(o.username).toBe('fleetfuel_owner');
    });
  });

  it('la clave por omisión GRITA que hay que cambiarla', async () => {
    // No es un detalle estético: es la única señal que tiene quien despliega de
    // que está a punto de publicar con una contraseña conocida.
    await jest.isolateModulesAsync(async () => {
      jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
      const { AppDataSource } = await import('./data-source');
      expect((AppDataSource.options as { password?: string }).password)
        .toBe('cambiar_en_produccion');
    });
  });
});
