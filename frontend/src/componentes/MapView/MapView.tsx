'use client';

import { MapControl } from '@/componentes/MapControl/MapControl';
import estilos from './MapView.module.css';

interface Props {
  cargando?: boolean;
  /** Descripción textual de la ruta, para quien no ve el mapa. */
  resumen?: string;
}

/**
 * Ficha 20 · Mapa con controles.
 *
 * El trazo es SVG de marcador de posición hasta que se integre el proveedor
 * real (Fase 2B, ingesta GPS). Lo que sí es definitivo son las medidas, la
 * posición de los controles y el tratamiento accesible: el mapa nunca es la
 * única fuente de la información, siempre va acompañado de un resumen en
 * texto. Un mapa es, por definición, invisible para un lector de pantalla.
 */
export function MapView({ cargando, resumen = 'Ruta con 4 paradas; el vehículo está en la segunda.' }: Props) {
  return (
    <div className={estilos.marco}>
      {cargando ? (
        <div className={estilos.cargando} aria-hidden />
      ) : (
        <>
          <svg className={estilos.lienzo} viewBox="0 0 400 232" aria-hidden focusable="false">
            <path d="M20 40h90v70h150v60h120" stroke="#2A313C" strokeWidth={10} fill="none" />
            <path d="M40 200h330M180 12v208" stroke="#1B212A" strokeWidth={6} fill="none" />
            {/* Ruta 3 px en color de acción */}
            <path d="M40 190C110 190 120 120 190 120S300 70 360 60"
                  stroke="var(--action)" strokeWidth={3} fill="none"
                  strokeLinecap="round" strokeLinejoin="round" />
            {/* Nodos 8 px */}
            <circle cx="40"  cy="190" r="4" fill="#FCFDFD" />
            <circle cx="190" cy="120" r="4" fill="#FCFDFD" />
            <circle cx="360" cy="60"  r="4" fill="#FCFDFD" />
            {/* Posición actual 14 px con anillo blanco */}
            <circle cx="120" cy="163" r="7" fill="var(--action)" stroke="#FFFFFF" strokeWidth={2.5} />
          </svg>

          {/* El resumen no es decorativo: es la única vía por la que el
              contenido del mapa llega a un lector de pantalla. */}
          <p className="solo-lectores">{resumen}</p>

          <div className={estilos.superior}>
            <MapControl etiqueta="Capas del mapa" controles={[
              { icono: 'flota', titulo: 'Capas' },
              { icono: 'seguimiento', titulo: 'Centrar en el vehículo' },
              { icono: 'ordenes', titulo: 'Abrir chat' },
            ]} />
          </div>
          <div className={estilos.inferior}>
            <MapControl etiqueta="Zoom" controles={[
              { icono: 'mas', titulo: 'Acercar' },
              { icono: 'chevron', titulo: 'Alejar' },
            ]} />
          </div>
        </>
      )}
    </div>
  );
}
