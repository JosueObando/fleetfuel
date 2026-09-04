import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';

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
 * Detrás de un proxy inverso, `@Ip()` devuelve la IP del PROXY, no la del
 * cliente: sin esto, la auditoría registraría cada inicio de sesión como
 * proveniente del proxy y la traza de «quién entró desde dónde» quedaría
 * destruida en silencio, sin un solo error.
 *
 * Se confía en una lista explícita de proxies y NUNCA en `true`. Con `true`,
 * Express acepta el `X-Forwarded-For` de cualquiera: un cliente podría
 * falsificar su propia IP en la auditoría, que es peor que no registrarla.
 */
function configurarProxyDeConfianza(
  app: NestExpressApplication, config: ConfigService, log: Logger,
) {
  const lista = (config.get<string>('proxiesDeConfianza') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (lista.length === 0) {
    log.log('Sin proxy de confianza: se usa la IP del socket. Correcto si no hay proxy delante.');
    return;
  }
  app.set('trust proxy', lista);
  log.log(`Proxies de confianza: ${lista.join(', ')} — se leerá X-Forwarded-For de ellos.`);
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
