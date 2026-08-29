import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

cargarEnv({ path: join(__dirname, '../../../.env') });
cargarEnv();

/**
 * Fuente de datos para migraciones y seeds: se conecta como DUEÑO del esquema.
 *
 * La aplicación en caliente usa otra conexión, con el rol restringido que crea
 * la migración base. Mezclarlas anularía la RLS, porque en Postgres el dueño de
 * una tabla evade sus propias políticas.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5433', 10),
  database: process.env.DATABASE_NAME || 'fleetfuel_db',
  username: process.env.DATABASE_USER || 'fleetfuel_owner',
  password: process.env.DATABASE_PASSWORD || 'cambiar_en_produccion',
  entities: [join(__dirname, '../modules/**/entidades/*.entidad.{ts,js}')],
  migrations: [join(__dirname, 'migrations/*.{ts,js}')],
  synchronize: false,
  logging: ['error', 'migration'],
});

// Sin `export default`: el cargador del CLI de TypeORM (`loadDataSource`)
// rechaza un archivo con más de un export que sea instancia de DataSource, y
// el default más el nombrado contaban como dos.
