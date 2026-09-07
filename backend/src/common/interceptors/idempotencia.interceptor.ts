import {
  CallHandler, ConflictException, ExecutionContext, Injectable,
  NestInterceptor, UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { from, Observable, tap } from 'rxjs';
import { contextoOpcional } from '../contexto/contexto-peticion';
import { SIN_IDEMPOTENCIA } from '../decorators/sin-idempotencia.decorator';
import { ES_PUBLICO } from '../decorators/publico.decorator';

/**
 * Idempotencia obligatoria en todo POST (ADR 004).
 *
 * Sin esto el modo sin conexión duplica datos: la app del conductor reintenta
 * una carga cuya respuesta se perdió en la red, y el sistema registra dos
 * cargas del mismo camión. En un negocio cuyo riesgo principal es el fraude de
 * volumen (§7), un duplicado no es una molestia — es un descuadre.
 *
 * Tres respuestas posibles ante una clave ya vista:
 *   · misma clave, misma huella, completada  → se devuelve la respuesta guardada
 *   · misma clave, misma huella, en curso    → 409, el original sigue corriendo
 *   · misma clave, huella distinta           → 422, el cliente reusó la clave
 *
 * El tercer caso es el que justifica guardar la huella: sin ella, reusar una
 * clave con otro cuerpo devuelve la respuesta de una operación distinta, que es
 * peor que fallar.
 */
@Injectable()
export class IdempotenciaInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const peticion = ctx.switchToHttp().getRequest();
    if (peticion.method !== 'POST') return next.handle();

    const exento =
      this.reflector.getAllAndOverride<boolean>(SIN_IDEMPOTENCIA, [ctx.getHandler(), ctx.getClass()]) ||
      this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [ctx.getHandler(), ctx.getClass()]);
    if (exento) return next.handle();

    const clave = peticion.headers?.['idempotency-key'];
    if (!clave || typeof clave !== 'string' || clave.length < 8 || clave.length > 120) {
      throw new UnprocessableEntityException(
        'Falta la cabecera Idempotency-Key (entre 8 y 120 caracteres). Es obligatoria en todo POST.',
      );
    }

    return from(this.conRegistro(clave, peticion, ctx, next));
  }

  private async conRegistro(
    clave: string,
    peticion: Record<string, any>,
    ctx: ExecutionContext,
    next: CallHandler,
  ): Promise<unknown> {
    const contexto = contextoOpcional();
    if (!contexto) return firstValue(next.handle());

    const huella = huellaDe(peticion);
    const ttl = this.config.get<number>('idempotencia.ttlHoras') ?? 24;

    // El INSERT es la sección crítica: la unicidad (empresa_id, clave) la
    // resuelve el motor, así que dos reintentos simultáneos no pueden ambos
    // creer que son el primero.
    const insertadas: Array<{ clave_id: string }> = await contexto.manager.query(
      `INSERT INTO claves_idempotencia (empresa_id, clave, huella, estado, expira_en)
       VALUES ($1, $2, $3, 'en_curso', now() + ($4 || ' hours')::interval)
       ON CONFLICT (empresa_id, clave) DO NOTHING
       RETURNING clave_id`,
      [contexto.empresaId, clave, huella, String(ttl)],
    );

    if (insertadas.length === 0) {
      const [previa] = await contexto.manager.query(
        `SELECT huella, estado, codigo_http, respuesta
           FROM claves_idempotencia WHERE empresa_id = $1 AND clave = $2`,
        [contexto.empresaId, clave],
      );
      if (!previa) throw new ConflictException('La clave de idempotencia cambió durante la petición.');
      if (previa.huella !== huella) {
        throw new UnprocessableEntityException(
          'Esa Idempotency-Key ya se usó con un cuerpo distinto. Usa una clave nueva.',
        );
      }
      if (previa.estado === 'en_curso') {
        throw new ConflictException('Una petición con esa clave sigue en curso. Reintenta en unos segundos.');
      }
      const respuesta = ctx.switchToHttp().getResponse();
      if (previa.codigo_http) respuesta.status(previa.codigo_http);
      respuesta.setHeader('Idempotent-Replay', 'true');
      return previa.respuesta;
    }

    const resultado = await firstValue(next.handle());
    const codigo = ctx.switchToHttp().getResponse().statusCode ?? 201;
    await contexto.manager.query(
      `UPDATE claves_idempotencia
          SET estado = 'completada', codigo_http = $3, respuesta = $4::jsonb
        WHERE empresa_id = $1 AND clave = $2`,
      [contexto.empresaId, clave, codigo, JSON.stringify(resultado ?? null)],
    );
    return resultado;
  }
}

/**
 * Huella del cuerpo y la ruta. Se ordenan las claves antes de serializar para
 * que dos JSON equivalentes con distinto orden de campos —cosa habitual entre
 * clientes— produzcan la misma huella y no un falso 422.
 */
export function huellaDe(peticion: { method?: string; url?: string; body?: unknown }): string {
  const canonico = JSON.stringify({
    m: peticion.method,
    u: peticion.url,
    b: ordenar(peticion.body),
  });
  return createHash('sha256').update(canonico).digest('hex');
}

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === 'object') {
    return Object.keys(valor)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = ordenar((valor as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return valor;
}

function firstValue(obs: Observable<unknown>): Promise<unknown> {
  return new Promise((resolver, rechazar) => {
    let ultimo: unknown;
    obs.pipe(tap()).subscribe({
      next: (v) => (ultimo = v),
      error: rechazar,
      complete: () => resolver(ultimo),
    });
  });
}
