import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';

import { REDIS } from '../../modules/auth/tokens.service';
import { AlmacenRedisDeThrottler } from './almacen-redis.throttler';
import {
  FRENO_CUENTA, FRENO_IP, rastreadorPorCuenta, rastreadorPorIp,
} from './rastreadores';

const aMilisegundos = (segundos: number) => segundos * 1000;

/**
 * El freno de fuerza bruta del login.
 *
 * No se registra como guard global: se aplica con `@UseGuards(ThrottlerGuard)`
 * sólo donde hace falta (ver `auth.controller.ts`). Un freno global tendría que
 * elegir un límite que valga a la vez para el login y para las pantallas que
 * hacen decenas de peticiones al pintarse, y ese número no existe: o es tan
 * alto que no frena el login, o es tan bajo que rompe la interfaz.
 *
 * `ThrottlerModule` se declara `@Global()` a sí mismo, así que basta con
 * importar este módulo una vez en `AppModule`. `REDIS` se resuelve porque
 * `AuthModule` es `@Global` y lo exporta; si algún día dejara de serlo, esto
 * fallaría al arrancar —ruidosamente, que es lo correcto—, no en silencio.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, REDIS],
      useFactory: (config: ConfigService, redis: Redis) => {
        const ventana = config.get<number>('login.ventanaSegundos') ?? 60;
        const bloqueo = config.get<number>('login.bloqueoSegundos') ?? 300;
        return {
          storage: new AlmacenRedisDeThrottler(redis),
          // Genérico a propósito: decir «esta cuenta está bloqueada» convertiría
          // el 429 en el oráculo de correos registrados que el 401 evita.
          errorMessage: 'Demasiados intentos. Espera un momento y vuelve a intentarlo.',
          throttlers: [
            {
              name: FRENO_CUENTA,
              ttl: aMilisegundos(ventana),
              limit: config.get<number>('login.limitePorCuenta') ?? 5,
              blockDuration: aMilisegundos(bloqueo),
              getTracker: rastreadorPorCuenta,
            },
            {
              name: FRENO_IP,
              ttl: aMilisegundos(ventana),
              limit: config.get<number>('login.limitePorIp') ?? 30,
              blockDuration: aMilisegundos(bloqueo),
              getTracker: rastreadorPorIp,
            },
          ],
        };
      },
    }),
  ],
})
export class ThrottlingModule {}
