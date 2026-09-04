'use client';

import { Icon, type NombreIcono } from '@/componentes/Icon/Icon';
import estilos from './Button.module.css';

interface Props {
  children: React.ReactNode;
  variante?: 'primario' | 'secundario';
  icono?: NombreIcono;
  deshabilitado?: boolean;
  cargando?: boolean;
  onClick?: () => void;
}

/** Ficha 16 · Acciones. */
export function Button({
  children, variante = 'primario', icono, deshabilitado, cargando, onClick,
}: Props) {
  const clases = [estilos.boton, estilos[variante], cargando && estilos.cargando]
    .filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={clases}
      disabled={deshabilitado || cargando}
      onClick={onClick}
      aria-busy={cargando || undefined}
    >
      {/* El girador sustituye al icono, no se suma: si se sumara, el botón
          cambiaría de ancho al empezar a cargar y saltaría bajo el cursor. */}
      {cargando ? <span className={estilos.girador} aria-hidden />
                : icono && <Icon nombre={icono} tamano={16} />}
      <span>{children}</span>
    </button>
  );
}
