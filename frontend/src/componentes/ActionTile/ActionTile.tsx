'use client';

import { Icon } from '@/componentes/Icon/Icon';
import estilos from './ActionTile.module.css';

interface Props {
  etiqueta?: string;
  deshabilitado?: boolean;
  cargando?: boolean;
  onClick?: () => void;
}

/** Ficha 22 · Solicitar foto. Dispara notificación al conductor. */
export function ActionTile({
  etiqueta = 'Pedir foto', deshabilitado, cargando, onClick,
}: Props) {
  return (
    <button
      type="button"
      className={estilos.celda}
      disabled={deshabilitado || cargando}
      onClick={onClick}
      aria-busy={cargando || undefined}
    >
      <Icon nombre="camara" tamano={20} />
      <span>{cargando ? 'Enviando…' : etiqueta}</span>
    </button>
  );
}
