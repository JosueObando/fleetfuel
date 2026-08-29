import { SetMetadata } from '@nestjs/common';

export const SIN_IDEMPOTENCIA = 'sinIdempotencia';
/**
 * Exime a un POST de exigir cabecera Idempotency-Key.
 *
 * ADR 004 la hace obligatoria en todo POST, y por eso la exención es explícita
 * y visible en el código: login o refresh no pueden exigirla —el cliente aún no
 * tiene sesión ni contexto de empresa donde guardar la clave—, pero cualquier
 * otro uso de este decorador debería costar una discusión en revisión.
 */
export const SinIdempotencia = () => SetMetadata(SIN_IDEMPOTENCIA, true);
