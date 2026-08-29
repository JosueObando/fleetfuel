import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { CambioAuditado, Contexto, contextoOpcional } from '../contexto/contexto-peticion';

const MUTACIONES = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Bitácora de accesos y cambios (§21), como interceptor global.
 *
 * La §4 es tajante sobre por qué no puede ser una llamada explícita en cada
 * servicio: «si depende de que el desarrollador se acuerde, tarde o temprano
 * falta un registro y el §21 deja de cumplirse». Así que aquí se registra toda
 * mutación por el solo hecho de ocurrir, sin que ningún módulo colabore.
 *
 * Lo que el interceptor no puede saber es el valor ANTERIOR de lo que cambió:
 * eso sólo lo conoce el servicio que lo leyó antes de escribir. Para eso está
 * `auditar()` del contexto — enriquece el registro, no lo produce. Si nadie
 * enriquece, igual queda constancia de quién llamó a qué, desde dónde y cuándo.
 *
 * Escribe dentro de la MISMA transacción de la petición: si la operación se
 * revierte, su registro de auditoría también. Una bitácora que afirma cambios
 * que no ocurrieron es peor que no tenerla.
 */
@Injectable()
export class AuditoriaInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const peticion = ctx.switchToHttp().getRequest();
    if (!MUTACIONES.has(peticion.method)) return next.handle();

    return from(this.registrando(peticion, next));
  }

  private async registrando(peticion: Record<string, any>, next: CallHandler): Promise<unknown> {
    const resultado = await firstValue(next.handle());
    const contexto = contextoOpcional();
    if (contexto) await this.persistir(contexto, peticion, resultado);
    return resultado;
  }

  private async persistir(
    contexto: Contexto,
    peticion: Record<string, any>,
    resultado: unknown,
  ): Promise<void> {
    // Un servicio que declaró cambios manda: su antes/después vale más que la
    // vista genérica de la petición.
    const cambios: CambioAuditado[] = contexto.cambios.length
      ? contexto.cambios
      : [{
          entidad: entidadDeRuta(peticion),
          entidadId: idDe(resultado) ?? peticion.params?.id ?? null,
          valorAnterior: null,
          valorNuevo: sanear(peticion.body),
        }];

    for (const cambio of cambios) {
      await contexto.manager.query(
        `INSERT INTO auditoria
           (empresa_id, usuario_id, accion, entidad, entidad_id,
            valor_anterior, valor_nuevo, motivo, ip, dispositivo, ruta)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::inet,$10,$11)`,
        [
          contexto.empresaId,
          contexto.usuarioId,
          peticion.method,
          cambio.entidad,
          cambio.entidadId ?? null,
          cambio.valorAnterior ? JSON.stringify(sanear(cambio.valorAnterior)) : null,
          cambio.valorNuevo ? JSON.stringify(sanear(cambio.valorNuevo)) : null,
          cambio.motivo ?? peticion.body?.motivo ?? null,
          contexto.ip ?? null,
          (contexto.dispositivo ?? '').slice(0, 240) || null,
          contexto.ruta ?? null,
        ],
      );
    }
  }
}

/** Campos que nunca deben aterrizar en la bitácora, ni siquiera cifrados. */
const PROHIBIDOS = new Set([
  'clave', 'claveActual', 'claveNueva', 'password', 'hash_clave', 'hashClave',
  'mfaSecreto', 'mfa_secreto', 'token', 'refreshToken', 'accessToken',
  'codigoTotp', 'cedula', 'cuentaBancaria',
]);

/**
 * §21 pide guardar el valor anterior y el nuevo; §7 prohíbe que datos sensibles
 * queden legibles. Se conserva la forma del cambio y se sustituye el contenido.
 */
export function sanear(valor: unknown): Record<string, unknown> | null {
  if (!valor || typeof valor !== 'object') return null;
  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if (PROHIBIDOS.has(k)) { salida[k] = '«omitido»'; continue; }
    salida[k] = v && typeof v === 'object' && !Array.isArray(v) ? sanear(v) : v;
  }
  return salida;
}

function entidadDeRuta(peticion: { route?: { path?: string }; url?: string }): string {
  const ruta = peticion.route?.path ?? peticion.url ?? '';
  const primer = ruta.split('?')[0].split('/').filter((s) => s && !s.startsWith(':'))[0];
  return primer ?? 'desconocida';
}

function idDe(resultado: unknown): string | null {
  if (!resultado || typeof resultado !== 'object') return null;
  const r = resultado as Record<string, unknown>;
  const id = r.id ?? r.usuarioId ?? r.rolId ?? r.empresaId ?? r.dispositivoId;
  return id == null ? null : String(id);
}

function firstValue(obs: Observable<unknown>): Promise<unknown> {
  return new Promise((resolver, rechazar) => {
    let ultimo: unknown;
    obs.subscribe({ next: (v) => (ultimo = v), error: rechazar, complete: () => resolver(ultimo) });
  });
}
