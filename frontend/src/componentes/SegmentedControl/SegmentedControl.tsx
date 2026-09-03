'use client';

import estilos from './SegmentedControl.module.css';

export interface Opcion {
  id: string;
  etiqueta: string;
  conteo?: number;
}

interface Props {
  opciones: Opcion[];
  seleccionada: string;
  etiquetaGrupo?: string;
  deshabilitado?: boolean;
  onSeleccionar?: (id: string) => void;
}

/**
 * Ficha 8 · Segmentado exclusivo.
 *
 * Siempre hay una opción activa: por eso el spec marca «deshabilitado: n/a».
 * Se modela con radios reales y no con botones, porque un grupo de radios ya
 * trae de fábrica la navegación con flechas y el anuncio «1 de 3» — que con
 * botones habría que reimplementar a mano, casi siempre mal.
 */
export function SegmentedControl({
  opciones, seleccionada, etiquetaGrupo = 'Mostrar', deshabilitado, onSeleccionar,
}: Props) {
  return (
    <div className={estilos.grupo} role="radiogroup" aria-label={etiquetaGrupo}>
      {opciones.map(o => {
        const activa = o.id === seleccionada;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={activa}
            className={`${estilos.opcion} ${activa ? estilos.activa : ''}`}
            disabled={deshabilitado}
            onClick={() => onSeleccionar?.(o.id)}
          >
            <span>{o.etiqueta}</span>
            {o.conteo !== undefined && <span className={estilos.conteo}>{o.conteo}</span>}
          </button>
        );
      })}
    </div>
  );
}
