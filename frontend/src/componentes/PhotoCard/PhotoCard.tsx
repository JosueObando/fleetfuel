'use client';

import { Icon } from '@/componentes/Icon/Icon';
import estilos from './PhotoCard.module.css';

export type EstadoFoto = 'ok' | 'pendiente' | 'problema';

export interface Foto {
  id: string;
  titulo: string;
  direccion: string;
  hora: string;
  estado: EstadoFoto;
  deshabilitada?: boolean;
}

const NOMBRE_ESTADO: Record<EstadoFoto, string> = {
  ok: 'Verificada', pendiente: 'Pendiente', problema: 'Con incidencia',
};

/** Ficha 21 · Tarjeta de reporte fotográfico. */
export function PhotoCard({ foto, onClick }: { foto: Foto; onClick?: () => void }) {
  return (
    <button
      type="button"
      className={estilos.tarjeta}
      disabled={foto.deshabilitada}
      onClick={onClick}
      /* Un solo nombre accesible que junta las cuatro piezas: sin esto, el
         lector leería «Verificada» sin decir de qué foto ni cuándo. */
      aria-label={`${foto.titulo}, ${foto.direccion}, ${foto.hora}, ${NOMBRE_ESTADO[foto.estado]}`}
    >
      <div className={estilos.marco}>
        <Icon nombre="camara" tamano={20} />
        <span className={`${estilos.punto} ${estilos[foto.estado]}`} aria-hidden />
      </div>
      <div className={estilos.titulo} aria-hidden>{foto.titulo}</div>
      <div className={estilos.meta} aria-hidden>{foto.direccion}</div>
      <div className={estilos.meta} aria-hidden>{foto.hora}</div>
    </button>
  );
}
