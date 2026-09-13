'use client';

import { useSyncExternalStore } from 'react';
import { instantaneaDeSesion, sesionDelServidor, suscribirseASesion } from './cliente';

/**
 * El id de quien mira, o `null` si no se sabe.
 *
 * EXISTE POR UNA REGLA QUE SE REPITE
 *
 * El backend separa quien hace de quien da por bueno en tres sitios: quien pide
 * un cambio de ruta no lo resuelve, quien registra un gasto no lo aprueba, y
 * quien calcula una liquidación no la aprueba. Lo aplica con un 409. La
 * pantalla no debe ni ofrecer el gesto sobre lo propio: un botón que existe
 * para fallar enseña que los botones mienten.
 *
 * `null` durante la hidratación —la instantánea del servidor es nula a
 * propósito— y sin sesión. Quien lo use tiene que tratar `null` como «no
 * ofrecer»: ofrecerlo todo sería ofrecer también lo propio.
 */
export function useUsuarioActual(): string | null {
  const sesion = useSyncExternalStore(suscribirseASesion, instantaneaDeSesion, sesionDelServidor);
  return sesion?.usuario?.id ? String(sesion.usuario.id) : null;
}

/** Si quien mira puede dar por bueno algo hecho por `autor`. */
export const puedeDarPorBueno = (yo: string | null, autor: unknown) =>
  yo !== null && String(autor) !== yo;
