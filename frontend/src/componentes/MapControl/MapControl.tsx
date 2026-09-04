'use client';

import { Icon, type NombreIcono } from '@/componentes/Icon/Icon';
import estilos from './MapControl.module.css';

export interface Control {
  icono: NombreIcono;
  /* Obligatorio: son botones sin label visible sobre un mapa. */
  titulo: string;
  deshabilitado?: boolean;
  onClick?: () => void;
}

/** Parte de la ficha 20 · Grupo de controles flotantes del mapa. */
export function MapControl({ controles, etiqueta }: { controles: Control[]; etiqueta: string }) {
  return (
    <div className={estilos.grupo} role="group" aria-label={etiqueta}>
      {controles.map(c => (
        <button
          key={c.titulo}
          type="button"
          className={estilos.control}
          disabled={c.deshabilitado}
          onClick={c.onClick}
          aria-label={c.titulo}
          title={c.titulo}
        >
          <Icon nombre={c.icono} tamano={16} />
        </button>
      ))}
    </div>
  );
}
