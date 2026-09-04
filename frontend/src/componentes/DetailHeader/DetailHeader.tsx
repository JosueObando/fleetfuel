'use client';

import { Button } from '@/componentes/Button/Button';
import { StatusBadge, type EstadoEnvio } from '@/componentes/StatusBadge/StatusBadge';
import estilos from './DetailHeader.module.css';

interface Props {
  identificador: string;
  estado: EstadoEnvio;
  deshabilitado?: boolean;
  llamandoEnCurso?: boolean;
}

/** Ficha 15 · Cabecera del panel de detalle. */
export function DetailHeader({ identificador, estado, deshabilitado, llamandoEnCurso }: Props) {
  return (
    <header className={estilos.cabecera}>
      <div className={estilos.izquierda}>
        <h2 className={estilos.identificador}>{identificador}</h2>
        <StatusBadge estado={estado} />
      </div>
      <div className={estilos.acciones}>
        <Button variante="secundario" icono="telefono"
                deshabilitado={deshabilitado} cargando={llamandoEnCurso}>
          Llamar al conductor
        </Button>
        <Button variante="primario" icono="ordenes" deshabilitado={deshabilitado}>
          Escribir al conductor
        </Button>
      </div>
    </header>
  );
}
