import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

export const REDIS = Symbol('REDIS');

/**
 * Almacén de refresh tokens vigentes (§7: «refresh de 7 días revocable»).
 *
 * Un JWT firmado no se puede invalidar: mientras no expire, vale. Por eso el
 * refresh se guarda por su identificador (jti) en Redis y se comprueba en cada
 * uso — si no está, no vale, aunque la firma sea correcta. Ahí es donde muerde
 * la revocación de dispositivos del §7.
 *
 * Se indexa además por dispositivo para poder cortar de un tajo todas las
 * sesiones de un equipo perdido o robado.
 */
@Injectable()
export class TokensService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  private clave(jti: string) { return `ff:refresh:${jti}`; }
  private claveDispositivo(empresaId: string, dispositivoId: string) {
    return `ff:dispositivo:${empresaId}:${dispositivoId}`;
  }

  async registrar(datos: { usuarioId: string; empresaId: string; dispositivoId: string | null }): Promise<string> {
    const jti = randomUUID();
    const ttl = segundosDe(this.config.get<string>('jwt.refreshExpiresIn') ?? '7d');
    const multi = this.redis.multi();
    multi.set(this.clave(jti), JSON.stringify(datos), 'EX', ttl);
    if (datos.dispositivoId) {
      const idx = this.claveDispositivo(datos.empresaId, datos.dispositivoId);
      multi.sadd(idx, jti);
      multi.expire(idx, ttl);
    }
    await multi.exec();
    return jti;
  }

  async vigente(jti: string): Promise<boolean> {
    return (await this.redis.exists(this.clave(jti))) === 1;
  }

  async revocar(jti: string): Promise<void> {
    await this.redis.del(this.clave(jti));
  }

  /** Corta todas las sesiones abiertas desde un dispositivo (§7). */
  async revocarDispositivo(empresaId: string, dispositivoId: string): Promise<number> {
    const idx = this.claveDispositivo(empresaId, dispositivoId);
    const jtis = await this.redis.smembers(idx);
    if (!jtis.length) return 0;
    await this.redis.del(...jtis.map((j) => this.clave(j)), idx);
    return jtis.length;
  }
}

/** Convierte «15m», «7d», «3600» a segundos. */
export function segundosDe(expresion: string): number {
  const m = /^(\d+)\s*([smhd])?$/.exec(expresion.trim());
  if (!m) throw new Error(`Duración no reconocida: ${expresion}`);
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case 'd': return n * 86400;
    case 'h': return n * 3600;
    case 'm': return n * 60;
    default: return n;
  }
}
