'use client';

import { useRef } from 'react';
import estilos from './Tabs.module.css';

export interface Pestana {
  id: string;
  etiqueta: string;
  deshabilitada?: boolean;
}

interface Props {
  pestanas: Pestana[];
  activa: string;
  etiquetaGrupo?: string;
  onCambiar?: (id: string) => void;
}

/**
 * Ficha 17 · Pestañas subrayadas.
 *
 * Patrón ARIA de tablist: una sola parada de tabulación para todo el grupo y
 * navegación con flechas dentro. Con cinco pestañas tabulables, llegar al
 * contenido cuesta cinco pulsaciones; así cuesta una.
 */
export function Tabs({ pestanas, activa, etiquetaGrupo = 'Secciones', onCambiar }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const alTeclado = (e: React.KeyboardEvent, indice: number) => {
    const paso = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!paso) return;
    e.preventDefault();

    // Salta las deshabilitadas y da la vuelta al llegar al extremo.
    let i = indice;
    for (let n = 0; n < pestanas.length; n++) {
      i = (i + paso + pestanas.length) % pestanas.length;
      if (!pestanas[i].deshabilitada) break;
    }
    const destino = pestanas[i];
    onCambiar?.(destino.id);
    refs.current[destino.id]?.focus();
  };

  return (
    <div className={estilos.lista} role="tablist" aria-label={etiquetaGrupo}>
      {pestanas.map((p, i) => {
        const esActiva = p.id === activa;
        return (
          <button
            key={p.id}
            ref={el => { refs.current[p.id] = el; }}
            type="button"
            role="tab"
            id={`pestana-${p.id}`}
            aria-selected={esActiva}
            aria-controls={`panel-${p.id}`}
            /* Solo la activa es tabulable: es lo que convierte el grupo en
               una única parada de tabulación. */
            tabIndex={esActiva ? 0 : -1}
            disabled={p.deshabilitada}
            className={`${estilos.pestana} ${esActiva ? estilos.activa : ''}`}
            onClick={() => onCambiar?.(p.id)}
            onKeyDown={e => alTeclado(e, i)}
          >
            {p.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
