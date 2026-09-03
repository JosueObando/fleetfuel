'use client';

import estilos from './FilterChip.module.css';

export interface Socio {
  id: string;
  etiqueta: string;
  conteo: number;
  activo?: boolean;
  deshabilitado?: boolean;
}

interface Props {
  socios: Socio[];
  overline?: string;
  onAlternar?: (id: string) => void;
}

/** Ficha 7 · Filtro múltiple por socios. */
export function FilterChip({ socios, overline = 'Filtrar por socios', onAlternar }: Props) {
  return (
    <div className={estilos.grupo}>
      <div className={estilos.overline} id="overline-socios">{overline}</div>
      {/* group + aria-labelledby: los chips son varios botones sueltos; sin
          esto el lector de pantalla no sabe de qué filtro forman parte. */}
      <div className={estilos.flujo} role="group" aria-labelledby="overline-socios">
        {socios.map(s => (
          <button
            key={s.id}
            type="button"
            className={`${estilos.chip} ${s.activo ? estilos.activo : ''}`}
            disabled={s.deshabilitado}
            /* Multi-selección: aria-pressed, no aria-current. Cada chip es un
               interruptor independiente que puede estar encendido a la vez
               que los demás. */
            aria-pressed={Boolean(s.activo)}
            onClick={() => onAlternar?.(s.id)}
          >
            <span>{s.etiqueta}</span>
            <span className={estilos.contador}>{s.conteo}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
