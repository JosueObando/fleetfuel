'use client';

import { Icon, type NombreIcono } from '@/componentes/Icon/Icon';
import estilos from './NavItem.module.css';

interface Props {
  icono: NombreIcono;
  etiqueta: string;
  activo?: boolean;
  deshabilitado?: boolean;
  cargando?: boolean;
  /** Siempre colapsado: sólo icono (el kit y la maqueta). */
  colapsado?: boolean;
  /** Colapsa a icono ENTRE 1024 y 1279 px, por media query (el shell). */
  colapsable?: boolean;
  onClick?: () => void;
}

/** Ficha 2 · Navegación principal. */
export function NavItem({ icono, etiqueta, activo, deshabilitado, cargando, colapsado, colapsable, onClick }: Props) {
  const clases = [estilos.item, activo && estilos.activo, cargando && estilos.cargando,
    colapsado && estilos.colapsado, colapsable && estilos.colapsable]
    .filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={clases}
      disabled={deshabilitado || cargando}
      onClick={onClick}
      /* El tooltip nativo sólo cuando puede verse sin etiqueta. En el modo
         `colapsable` va puesto también a pantalla ancha —el componente no sabe
         el ancho, lo decide una media query—: es una repetición al pasar el
         ratón, y es lo que cuesta no medir la ventana con JavaScript. */
      title={colapsado || colapsable ? etiqueta : undefined}
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
