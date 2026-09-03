'use client';

import { Icon } from '@/componentes/Icon/Icon';
import estilos from './DashedCTA.module.css';

interface Props {
  /* Copy en español de Panamá, trato de tú, orientado al resultado. */
  etiqueta?: string;
  deshabilitado?: boolean;
  cargando?: boolean;
  onClick?: () => void;
}

/** Ficha 5 · CTA de creación, al pie del sidebar. */
export function DashedCTA({
  etiqueta = 'Crear una solicitud', deshabilitado, cargando, onClick,
}: Props) {
  return (
    <button
      type="button"
      className={`${estilos.cta} ${cargando ? estilos.cargando : ''}`}
      disabled={deshabilitado || cargando}
      onClick={onClick}
      aria-busy={cargando || undefined}
    >
      <span className={estilos.fab}>
        {!cargando && <Icon nombre="mas" tamano={20} />}
      </span>
      <span className={estilos.etiqueta}>{cargando ? '' : etiqueta}</span>
    </button>
  );
}
