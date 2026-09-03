'use client';

import { useId, useState } from 'react';
import { Icon } from '@/componentes/Icon/Icon';
import estilos from './NavGroup.module.css';

export interface SubItem {
  etiqueta: string;
  activo?: boolean;
  deshabilitado?: boolean;
}

interface Props {
  etiqueta: string;
  subitems: SubItem[];
  badge?: number;
  abiertoInicial?: boolean;
  deshabilitado?: boolean;
  cargando?: boolean;
}

/** Ficha 3 · Grupo colapsable con sub-ítems. */
export function NavGroup({
  etiqueta, subitems, badge, abiertoInicial = false, deshabilitado, cargando,
}: Props) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const idLista = useId();

  const clases = [estilos.grupo, abierto && estilos.abierto, cargando && estilos.cargando]
    .filter(Boolean).join(' ');

  return (
    <div className={clases}>
      <button
        type="button"
        className={estilos.cabecera}
        onClick={() => setAbierto(a => !a)}
        disabled={deshabilitado || cargando}
        /* aria-expanded + aria-controls: sin ellos el lector de pantalla no
           sabe que este botón abre algo, ni qué abre. */
        aria-expanded={abierto}
        aria-controls={idLista}
      >
        <span className={estilos.etiqueta}>{cargando ? '' : etiqueta}</span>
        {badge !== undefined && (
          <span className={estilos.badge}>{cargando ? '' : badge}</span>
        )}
        <span className={estilos.chevron}>
          <Icon nombre="chevron" tamano={16} />
        </span>
      </button>

      {/* `hidden` y no display:none por CSS: así el contenido sale del orden
          de tabulación cuando está cerrado, y no hay foco en lo invisible. */}
      <ul className={estilos.lista} id={idLista} hidden={!abierto}>
        {subitems.map(sub => (
          <li key={sub.etiqueta}>
            <button
              type="button"
              className={`${estilos.subitem} ${sub.activo ? estilos.subActivo : ''}`}
              disabled={sub.deshabilitado}
              aria-current={sub.activo ? 'page' : undefined}
            >
              {sub.etiqueta}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
