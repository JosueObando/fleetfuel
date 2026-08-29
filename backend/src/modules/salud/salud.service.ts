import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REDIS } from '../auth/tokens.service';

/**
 * `npm_package_version` sólo existe cuando el proceso lo lanzó npm. La etapa de
 * producción arranca con `node dist/main.js` directo, así que ahí no está: se
 * lee del package.json, que viaja en las dos imágenes. Se resuelve una vez al
 * cargar el módulo, no en cada petición.
 */
const VERSION = ((): string => {
  if (process.env.npm_package_version) return process.env.npm_package_version;
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version ?? 'desconocida';
  } catch {
    return 'desconocida';
  }
})();

export type EstadoDependencia = 'ok' | 'caida';

export interface Salud {
  estado: 'ok' | 'degradado';
  servicio: string;
  version: string;
  tiempoActivoSegundos: number;
  dependencias: { postgres: EstadoDependencia; redis: EstadoDependencia };
}

/** Ninguna comprobación puede tardar más que esto. Un chequeo de salud que se
 *  cuelga es peor que uno que falla: el monitor se queda esperando y nadie se
 *  entera de nada. */
const LIMITE_MS = 2000;

@Injectable()
export class SaludService {
  private readonly log = new Logger(SaludService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async revisar(): Promise<Salud> {
    const [postgres, redis] = await Promise.all([
      this.probar('postgres', () => this.dataSource.query('SELECT 1')),
      this.probar('redis', () => this.redis.ping()),
    ]);

    return {
      estado: postgres === 'ok' && redis === 'ok' ? 'ok' : 'degradado',
      servicio: 'FleetFuel Control · API',
      version: VERSION,
      tiempoActivoSegundos: Math.round(process.uptime()),
      dependencias: { postgres, redis },
    };
  }

  /**
   * El motivo del fallo se registra en el log del servidor, pero NO se devuelve
   * en la respuesta: esta ruta es pública, y un mensaje de error de Postgres
   * dice versiones, nombres de host y a veces credenciales. Hacia afuera basta
   * con «caida»; el detalle lo ve quien tiene acceso a los logs.
   */
  private async probar(nombre: string, fn: () => Promise<unknown>): Promise<EstadoDependencia> {
    let temporizador: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        fn(),
        new Promise((_, rechazar) => {
          temporizador = setTimeout(
            () => rechazar(new Error(`sin respuesta en ${LIMITE_MS} ms`)),
            LIMITE_MS,
          );
        }),
      ]);
      return 'ok';
    } catch (e) {
      this.log.error(`Dependencia ${nombre} caída: ${(e as Error).message}`);
      return 'caida';
    } finally {
      // Sin esto, cada chequeo sano deja un temporizador vivo dos segundos: el
      // race lo gana la consulta, pero el setTimeout perdedor sigue ahí. En un
      // proceso que recibe un chequeo por segundo son timers acumulándose para
      // nada, y es lo que hacía que Jest se quejara de handles abiertos.
      if (temporizador) clearTimeout(temporizador);
    }
  }
}
