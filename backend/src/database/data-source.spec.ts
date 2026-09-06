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
