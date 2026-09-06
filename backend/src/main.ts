import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { configurarProxyDeConfianza } from './config/proxy-de-confianza';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const log = new Logger('FleetFuel');

  await verificarRolDeAplicacion(app.get(DataSource), config, log);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableCors({ origin: true, credentials: true });
  configurarProxyDeConfianza(app, config, log);

  const puerto = config.get<number>('port') ?? 4100;
  await app.listen(puerto);
  log.log(`API escuchando en http://localhost:${puerto}/api`);
}

/**
 * En Postgres, el dueño de una tabla evade sus propias políticas RLS. Si la
 * aplicación se conecta con el usuario dueño —copiando el .env de migraciones,
 * que es el error más fácil de cometer— el aislamiento entre empresas
 * desaparece sin un solo síntoma: todo funciona, y cada operadora ve los datos
 * de las demás. Por eso se comprueba al arrancar y se rechaza arrancar.
 */
async function verificarRolDeAplicacion(ds: DataSource, config: ConfigService, log: Logger) {
  const [{ current_user: actual }] = await ds.query(`SELECT current_user`);
  const dueño = config.get<string>('database.owner');
  if (actual === dueño) {
    log.error(
      `La aplicación se está conectando como "${actual}", que es el dueño del esquema. ` +
      'El dueño evade la RLS: el aislamiento entre empresas quedaría anulado. ' +
      'Usa DATABASE_APP_USER / DATABASE_APP_PASSWORD.',
    );
    process.exit(1);
  }
  const [{ bypass }] = await ds.query(
    `SELECT rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`,
  );
  if (bypass) {
    log.error(`El rol "${actual}" tiene BYPASSRLS. Quítaselo: anula ADR 003.`);
    process.exit(1);
  }
  log.log(`Conectado como "${actual}" — sujeto a Row Level Security.`);
}

bootstrap();
