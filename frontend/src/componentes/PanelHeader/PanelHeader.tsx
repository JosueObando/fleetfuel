'use client';

import { Icon } from '@/componentes/Icon/Icon';
import estilos from './PanelHeader.module.css';

interface Props {
  titulo: string;
  deshabilitado?: boolean;
  cargando?: boolean;
  onBuscar?: () => void;
}

/** Ficha 6 · Título de panel + buscar. */
export function PanelHeader({ titulo, deshabilitado, cargando, onBuscar }: Props) {
  return (
    <header className={`${estilos.cabecera} ${cargando ? estilos.cargando : ''}`}>
      <h2 className={estilos.titulo}>{cargando ? '' : titulo}</h2>
      <button
        type="button"
        className={estilos.buscar}
        onClick={onBuscar}
        disabled={deshabilitado || cargando}
        aria-label={`Buscar en ${titulo}`}
      >
        <Icon nombre="buscar" tamano={20} />
      </button>
    </header>
  );
}
