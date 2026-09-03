/*
 * Icon · única puerta de entrada de iconografía del sistema.
 *
 * Ningún componente dibuja un SVG ni escribe una clase de icono directamente:
 * todos piden `<Icon nombre="..." />`. Eso permite cambiar la fuente de
 * iconos —hoy trazos propios al estilo UIcons Rounded— sin tocar ni uno de
 * los 24 componentes.
 *
 * Tamaños del spec: 20 px en navegación, 16 px en botones.
 */

export type NombreIcono =
  | 'seguimiento' | 'flota' | 'conductores' | 'ordenes' | 'informes'
  | 'ajustes' | 'ayuda' | 'campana' | 'buscar' | 'salir'
  | 'chevron' | 'mas' | 'camara' | 'telefono';

// Trazo redondeado, grosor 1.5, lienzo 24: el lenguaje de UIcons Rounded.
const TRAZOS: Record<NombreIcono, string> = {
  seguimiento: 'M3 12h4l3-7 4 14 3-7h4',
  flota:       'M3 16V9h11v7M14 11h4l3 4v1h-7M6.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  conductores: 'M12 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM5 20a7 7 0 0114 0',
  ordenes:     'M7 4h7l4 4v12H7zM14 4v4h4M10 13h5M10 16h5',
  informes:    'M5 20V10M12 20V4M19 20v-7',
  ajustes:     'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1l2-1.6-2-3.4-2.3 1a7 7 0 00-1.8-1L14.5 3h-4l-.4 2.5a7 7 0 00-1.8 1l-2.3-1-2 3.4 2 1.6a7 7 0 000 2l-2 1.6 2 3.4 2.3-1a7 7 0 001.8 1l.4 2.5h4l.4-2.5a7 7 0 001.8-1l2.3 1 2-3.4-2-1.6c.06-.33.1-.66.1-1z',
  ayuda:       'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 114 2c-.9.7-1.5 1.2-1.5 2.5M12 17.5h.01',
  campana:     'M18 16V11a6 6 0 10-12 0v5l-1.5 2h15zM10 21h4',
  buscar:      'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  salir:       'M14 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 16l-4-4 4-4M6 12h9',
  chevron:     'M9 6l6 6-6 6',
  mas:         'M12 6v12M6 12h12',
  camara:      'M4 8h3.5L9 6h6l1.5 2H20v11H4zM12 16.5a3 3 0 100-6 3 3 0 000 6z',
  telefono:    'M6 4h3l1.5 4-2 1.5a11 11 0 006 6l1.5-2 4 1.5v3a1 1 0 01-1 1A15 15 0 015 5a1 1 0 011-1z',
};

interface Props {
  nombre: NombreIcono;
  /** 20 en navegación, 16 en botones (spec). */
  tamano?: 16 | 20 | 24;
  /**
   * Texto alternativo. Si se omite, el icono se marca decorativo y los
   * lectores de pantalla lo saltan — que es lo correcto cuando va junto a un
   * label visible. Un icono decorativo anunciado es ruido, no accesibilidad.
   */
  titulo?: string;
  className?: string;
}

export function Icon({ nombre, tamano = 20, titulo, className }: Props) {
  const decorativo = titulo === undefined;
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"          /* hereda el color del texto: un icono nunca fija el suyo */
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={decorativo || undefined}
      role={decorativo ? undefined : 'img'}
      aria-label={titulo}
      focusable="false"
    >
      <path d={TRAZOS[nombre]} />
    </svg>
  );
}
