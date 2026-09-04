import type { EstadoEnvio } from '@/componentes/StatusBadge/StatusBadge';
import type { Parada } from '@/componentes/RouteTimeline/RouteTimeline';
import type { TipoVehiculo } from '@/componentes/VehicleThumb/VehicleThumb';

/*
 * Datos falsos del shell. UX-1 construye la estructura; los datos reales
 * llegan con 1A (catálogos) y 2B (GPS). Nombres del Distrito de Panamá para
 * que las medidas se prueben con texto verosímil.
 */
export interface Envio {
  id: string;
  socio: string;
  estado: EstadoEnvio;
  segundosRestantes: number;
  km: number;
  paradas: Parada[];
  vehiculo: TipoVehiculo;
  capacidad: number;
}

const RUTA = (actual: number): Parada[] =>
  ['Planta Panamá Oeste', 'Vía Ricardo J. Alfaro', 'Estación San Miguelito', 'Depósito Tocumen']
    .map((etiqueta, i) => ({
      etiqueta,
      fase: i < actual ? 'pasada' : i === actual ? 'actual' : 'futura',
    }));

export const ENVIOS: Envio[] = [
  { id: 'SD-4821-PTY', socio: 'aseo',    estado: 'enRuta',    segundosRestantes: 4521,  km: 18.4, paradas: RUTA(1), vehiculo: 'cisterna',  capacidad: 64 },
  { id: 'SD-4822-PTY', socio: 'aseo',    estado: 'esperando', segundosRestantes: 900,   km: 3.2,  paradas: RUTA(2), vehiculo: 'camion',    capacidad: 28 },
  { id: 'SD-4823-PTY', socio: 'obras',   estado: 'retrasado', segundosRestantes: 11400, km: 42.7, paradas: RUTA(0), vehiculo: 'furgoneta', capacidad: 94 },
  { id: 'SD-4824-PTY', socio: 'parques', estado: 'entregado', segundosRestantes: 0,     km: 0,    paradas: RUTA(3), vehiculo: 'cisterna',  capacidad: 0 },
  { id: 'SD-4825-PTY', socio: 'obras',   estado: 'enRuta',    segundosRestantes: 2760,  km: 11.9, paradas: RUTA(1), vehiculo: 'camion',    capacidad: 108 },
  { id: 'SD-4826-PTY', socio: 'aseo',    estado: 'enRuta',    segundosRestantes: 6300,  km: 27.5, paradas: RUTA(2), vehiculo: 'cisterna',  capacidad: 47 },
];

export const SOCIOS = [
  { id: 'aseo',    etiqueta: 'Aseo Urbano' },
  { id: 'obras',   etiqueta: 'Obras' },
  { id: 'parques', etiqueta: 'Parques' },
];

export const ACTIVOS: EstadoEnvio[] = ['enRuta', 'esperando', 'retrasado'];
