'use client';

import { Icon, type NombreIcono } from '@/componentes/Icon/Icon';
import estilos from './NavItem.module.css';

interface Props {
  icono: NombreIcono;
  etiqueta: string;
  activo?: boolean;
  deshabilitado?: boolean;
  cargando?: boolean;
  /** 1024-1279: sidebar de 72 px, solo icono. */
  colapsado?: boolean;
  onClick?: () => void;
}

/** Ficha 2 · Navegación principal. */
export function NavItem({ icono, etiqueta, activo, deshabilitado, cargando, colapsado, onClick }: Props) {
  const clases = [estilos.item, activo && estilos.activo, cargando && estilos.cargando,
    colapsado && estilos.colapsado]
    .filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={clases}
      disabled={deshabilitado || cargando}
      onClick={onClick}
      /* El tooltip nativo solo cuando está colapsado: con la etiqueta
         visible sería una repetición molesta al pasar el ratón. */
      title={colapsado ? etiqueta : undefined}
      /* aria-current marca la página actual para el lector de pantalla. Sin
         esto, el estado activo existiría solo como color — y el color no se
         anuncia. */
      aria-current={activo ? 'page' : undefined}
      aria-busy={cargando || undefined}
    >
      <span className={estilos.icono}>
        {!cargando && <Icon nombre={icono} tamano={20} />}
      </span>
      <span className={estilos.etiqueta}>{cargando ? '' : etiqueta}</span>
    </button>
  );
}
