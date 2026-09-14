'use client';

import type { ReactNode } from 'react';
import estilos from './BloqueDato.module.css';

/**
 * Un dato con su rótulo y su explicación, en una caja.
 *
 * Vive en `src/operacion/` y no en el kit de componentes a propósito: el kit
 * son las 24 fichas del spec de UX y tiene su propio contrato de estados y
 * contraste. Esto es un ladrillo de dos pantallas —el panel de liquidación del
 * §15.5 y los informes del §14—, y meterlo allí le daría un peso que no tiene.
 */
export function BloqueDato({ rotulo, dato, detalle, resaltado, children }: {
  rotulo: string; dato: string; detalle?: string; resaltado?: boolean;
  /** Lo que va al pie de la caja: en el panel del §15.1, a dónde se actúa. */
  children?: ReactNode;
}) {
  return (
    <div className={`${estilos.bloque} ${resaltado ? estilos.resaltado : ''}`}>
      <p className={estilos.rotulo}>{rotulo}</p>
      <p className={estilos.dato}>{dato}</p>
      {detalle && <p className={estilos.detalle}>{detalle}</p>}
      {children}
    </div>
  );
}
