'use client';

import { Button } from '@/componentes/Button/Button';
import estilos from './SectionHeader.module.css';

interface Props {
  titulo: string;
  /** Metadatos en línea: tiempo restante, distancia. */
  meta?: string;
  accion?: { etiqueta: string; onClick?: () => void; deshabilitada?: boolean };
}

/** Ficha 19 · Encabezado de sección con meta y acción. */
export function SectionHeader({ titulo, meta, accion }: Props) {
  return (
    <div className={estilos.barra}>
      <h3 className={estilos.titulo}>{titulo}</h3>
      <div className={estilos.derecha}>
        {meta && <span className={estilos.meta}>{meta}</span>}
        {accion && (
          <Button variante="secundario" icono="ordenes"
                  deshabilitado={accion.deshabilitada} onClick={accion.onClick}>
            {accion.etiqueta}
          </Button>
        )}
      </div>
    </div>
  );
}
