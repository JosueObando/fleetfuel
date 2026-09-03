'use client';

import { Icon, type NombreIcono } from '@/componentes/Icon/Icon';
import estilos from './NavItem.module.css';

interface Props {
  icono: NombreIcono;
  etiqueta: string;
  activo?: boolean;
  deshabilitado?: boolean;
  cargando?: boolean;
  onClick?: () => void;
}

/** Ficha 2 · Navegación principal. */
export function NavItem({ icono, etiqueta, activo, deshabilitado, cargando, onClick }: Props) {
  const clases = [estilos.item, activo && estilos.activo, cargando && estilos.cargando]
    .filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={clases}
      disabled={deshabilitado || cargando}
      onClick={onClick}
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
