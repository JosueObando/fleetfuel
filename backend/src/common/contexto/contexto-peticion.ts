import { AsyncLocalStorage } from 'node:async_hooks';
import { InternalServerErrorException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/** Un cambio que la auditoría debe registrar con su antes y su después (§21). */
export interface CambioAuditado {
  entidad: string;
  entidadId?: string | null;
  valorAnterior?: Record<string, unknown> | null;
  valorNuevo?: Record<string, unknown> | null;
  motivo?: string;
}

export interface Contexto {
  empresaId: string;
  usuarioId: string | null;
  /**
   * EntityManager de la transacción de ESTA petición. Es el único que tiene
   * fijado `app.empresa_id`, así que consultar por fuera de él devuelve cero
   * filas: la RLS no distingue entre "otra empresa" y "sin contexto".
   */
  manager: EntityManager;
  ip?: string;
  dispositivo?: string;
  ruta?: string;
  /** Los servicios empujan aquí lo que el interceptor no puede deducir solo. */
  cambios: CambioAuditado[];
  /**
   * Efectos que sólo deben ocurrir si la transacción CONFIRMA.
   *
   * Existen para lo que no vive en Postgres y por tanto no se revierte con él:
   * hoy, cortar sesiones en Redis al revocar un dispositivo. Hacerlo dentro de
   * la transacción falla ABIERTO —si algo posterior revienta, las sesiones
   * quedan cortadas y el dispositivo sin revocar, así que el equipo robado
   * vuelve a entrar—. Aplazarlo al commit invierte el peor caso: dispositivo
   * marcado con sus sesiones vivas como mucho lo que dure el token de acceso.
   */
  trasConfirmar?: Array<() => Promise<void>>;
}

const almacen = new AsyncLocalStorage<Contexto>();

export function ejecutarEnContexto<T>(contexto: Contexto, fn: () => T): T {
  return almacen.run(contexto, fn);
}

export function contextoActual(): Contexto {
  const ctx = almacen.getStore();
  if (!ctx) {
    // Pasa si un servicio se llama desde un job o un listener sin envolverlo.
    // Es preferible reventar que consultar sin aislamiento de empresa.
    throw new InternalServerErrorException(
      'No hay contexto de empresa en esta ejecución. Envuélvela con ejecutarEnContexto().',
    );
  }
  return ctx;
}

export function contextoOpcional(): Contexto | undefined {
  return almacen.getStore();
}

/** Azúcar para los servicios: el manager transaccional de la petición actual. */
export function gestor(): EntityManager {
  return contextoActual().manager;
}

/** Registra un cambio para la bitácora. El interceptor lo persiste al cerrar. */
export function auditar(cambio: CambioAuditado): void {
  contextoActual().cambios.push(cambio);
}

/**
 * Agenda un efecto para DESPUÉS de que la transacción confirme.
 *
 * Para lo que no es Postgres y por tanto no se revierte con él. Si el efecto
 * falla, la transacción ya está confirmada y no se deshace: quien lo use tiene
 * que elegir el orden de modo que ese sea el fallo aceptable.
 */
export function alConfirmar(efecto: () => Promise<void>): void {
  const ctx = contextoActual();
  (ctx.trasConfirmar ??= []).push(efecto);
}
