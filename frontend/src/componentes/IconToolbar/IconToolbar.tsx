'use client';

import { Icon, type NombreIcono } from '@/componentes/Icon/Icon';
import estilos from './IconToolbar.module.css';

export interface Utilidad {
  icono: NombreIcono;
  /* Obligatorio: son botones SIN label visible. Sin nombre accesible, un
     lector de pantalla anuncia «botón» cinco veces seguidas. */
  titulo: string;
  activo?: boolean;
  deshabilitado?: boolean;
}

interface Props {
  utilidades: Utilidad[];
  cargando?: boolean;
}

/** Ficha 4 · Barra de utilidades, al pie del sidebar. */
export function IconToolbar({ utilidades, cargando }: Props) {
  return (
    <div
      className={`${estilos.barra} ${cargando ? estilos.cargando : ''}`}
      role="toolbar"
      aria-label="Utilidades"
    >
      {utilidades.map(u => (
        <button
          key={u.icono}
          type="button"
          className={`${estilos.boton} ${u.activo ? estilos.activo : ''}`}
          disabled={u.deshabilitado || cargando}
          title={u.titulo}
          aria-label={u.titulo}
          aria-pressed={u.activo}
        >
          {!cargando && <Icon nombre={u.icono} tamano={16} />}
        </button>
      ))}
    </div>
  );
}
