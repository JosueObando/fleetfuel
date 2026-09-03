'use client';

import { StatusBadge, type EstadoEnvio } from '@/componentes/StatusBadge/StatusBadge';
import { MetricStack } from '@/componentes/MetricStack/MetricStack';
import { RouteTimeline, type Parada } from '@/componentes/RouteTimeline/RouteTimeline';
import { VehicleThumb, type TipoVehiculo } from '@/componentes/VehicleThumb/VehicleThumb';
import estilos from './ShipmentCard.module.css';

interface Props {
  identificador: string;
  estado: EstadoEnvio;
  segundosRestantes: number;
  km: number;
  paradas: Parada[];
  vehiculo: TipoVehiculo;
  seleccionada?: boolean;
  deshabilitado?: boolean;
  cargando?: boolean;
  onClick?: () => void;
}

/** Ficha 9 · Tarjeta de envío. Compone las fichas 10-13. */
export function ShipmentCard({
  identificador, estado, segundosRestantes, km, paradas, vehiculo,
  seleccionada, deshabilitado, cargando, onClick,
}: Props) {
  const clases = [estilos.tarjeta, seleccionada && estilos.seleccionada, cargando && estilos.cargando]
    .filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={clases}
      disabled={deshabilitado || cargando}
      onClick={onClick}
      /* La tarjeta selecciona un envío en el panel de detalle: es un estado
         de selección dentro de una lista, no una navegación. */
      aria-pressed={seleccionada}
      aria-busy={cargando || undefined}
    >
      <div className={estilos.encabezado}>
        <span className={estilos.identificador}>{cargando ? '' : identificador}</span>
        {!cargando && <StatusBadge estado={estado} />}
      </div>

      <div className={estilos.datos}>
        {!cargando && (
          <>
            <MetricStack segundosRestantes={segundosRestantes} km={km} />
            <RouteTimeline paradas={paradas} />
          </>
        )}
      </div>

      <div className={estilos.imagen}>
        {!cargando && <VehicleThumb tipo={vehiculo} />}
      </div>
    </button>
  );
}
