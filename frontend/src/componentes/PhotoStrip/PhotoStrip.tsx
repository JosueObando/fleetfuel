'use client';

import { PhotoCard, type Foto } from '@/componentes/PhotoCard/PhotoCard';
import { ActionTile } from '@/componentes/ActionTile/ActionTile';
import estilos from './PhotoStrip.module.css';

interface Props {
  fotos: Foto[];
  pidiendoFoto?: boolean;
  onPedirFoto?: () => void;
}

/** Ficha 21 · Tira de reportes fotográficos, con la celda de acción al final. */
export function PhotoStrip({ fotos, pidiendoFoto, onPedirFoto }: Props) {
  if (fotos.length === 0) {
    return (
      <div className={estilos.vacio}>
        Todavía no hay reportes de este viaje.
      </div>
    );
  }

  return (
    <div className={estilos.tira} role="list" aria-label="Reportes fotográficos">
      {fotos.map(f => (
        <div role="listitem" key={f.id}>
          <PhotoCard foto={f} />
        </div>
      ))}
      <ActionTile cargando={pidiendoFoto} onClick={onPedirFoto} />
    </div>
  );
}
