/**
 * §15.3 · La geometría del planificador, sin React: qué filas hay, dónde cae
 * cada viaje y qué conflictos de asignación tiene. Ver `cronograma.spec.ts`
 * para por qué los «solapes» NO son un conflicto aquí.
 *
 * Los días son UTC, el convenio con el que se guardan los viajes
 * (`app/operacion/viajes/fechas.ts`): mezclar zonas movería los bloques de día.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

export interface ViajePlan {
  id: string; codigoViaje: string; estado: string;
  cisternaId: string | null; conductorId: string | null; conductor: string | null;
  fechaProgramada: string; fechaInicio: string | null; fechaFin: string | null;
  destinos: string[]; retrasado: boolean;
}
export interface CisternaPlan { id: string; placa: string }

export type Grupo = 'planificacion' | 'autorizado' | 'enMarcha' | 'cerrado';
export interface Bloque {
  viaje: ViajePlan; grupo: Grupo;
  /** Porcentajes del ancho de la semana. */
  izquierda: number; ancho: number;
  /** Empezó antes de la semana / sigue después: el bloque está recortado. */
  cortaInicio: boolean; cortaFin: boolean;
}
export interface FilaCrono { clave: string; titulo: string; bloques: Bloque[] }
export type TipoConflicto = 'sinCisterna' | 'sinConductor' | 'sinFin' | 'retrasado';
export interface Conflicto { viaje: ViajePlan; tipo: TipoConflicto; texto: string }

export interface Ventana { desde: string; hasta: string; dias: string[] }

export const sumarDias = (dia: string, n: number) =>
  new Date(Date.parse(dia) + n * DIA_MS).toISOString().slice(0, 10);

/** El lunes de la semana del día dado. `getUTCDay` da 0 al domingo. */
export function lunesDe(dia: string): string {
  const semana = new Date(dia).getUTCDay();
  return sumarDias(dia, -((semana + 6) % 7));
}

export const hoyUtc = () => new Date(Date.now()).toISOString().slice(0, 10);

export function ventanaDe(desde: string, dias = 7): Ventana {
  return {
    desde: new Date(desde).toISOString(),
    hasta: new Date(Date.parse(desde) + dias * DIA_MS).toISOString(),
    dias: Array.from({ length: dias }, (_, i) => sumarDias(desde, i)),
  };
}

const GRUPO: Record<string, Grupo> = {
  borrador: 'planificacion', programado: 'planificacion', autorizado: 'autorizado', cerrado: 'cerrado',
};
const grupoDe = (estado: string): Grupo => GRUPO[estado] ?? 'enMarcha';

const diaLargo = new Intl.DateTimeFormat('es-PA', { day: 'numeric', month: 'long', timeZone: 'UTC' });

function conflictosDe(v: ViajePlan): Conflicto[] {
  // Un viaje terminado es historia, no una decisión pendiente.
  if (v.estado === 'cerrado') return [];
  const lista: Conflicto[] = [];
  if (!v.cisternaId) lista.push({ viaje: v, tipo: 'sinCisterna', texto: 'sin cisterna: no reserva ninguna' });
  if (!v.conductorId) lista.push({ viaje: v, tipo: 'sinConductor', texto: 'sin conductor: no reserva a nadie' });
  if (!v.fechaFin) lista.push({ viaje: v, tipo: 'sinFin', texto: 'sin fin previsto: ocupa su cisterna sin límite' });
  if (v.retrasado) lista.push({
    viaje: v, tipo: 'retrasado', texto: `retrasado: debió salir el ${diaLargo.format(new Date(v.fechaProgramada))}`,
  });
  return lista;
}

const inicioDe = (v: ViajePlan) => Date.parse(v.fechaInicio ?? v.fechaProgramada);

export function cronograma(viajes: ViajePlan[], cisternas: CisternaPlan[], ventana: Ventana) {
  const desde = Date.parse(ventana.desde), hasta = Date.parse(ventana.hasta);
  const total = hasta - desde;
  const vivos = viajes.filter(v => v.estado !== 'cancelado').sort((a, b) => inicioDe(a) - inicioDe(b));

  const bloque = (v: ViajePlan): Bloque => {
    const inicio = inicioDe(v);
    const fin = v.fechaFin ? Date.parse(v.fechaFin) : Infinity;
    const izq = Math.max(inicio, desde), der = Math.min(fin, hasta);
    return {
      viaje: v, grupo: grupoDe(v.estado),
      izquierda: ((izq - desde) / total) * 100, ancho: ((der - izq) / total) * 100,
      cortaInicio: inicio < desde, cortaFin: fin > hasta,
    };
  };

  const filas: FilaCrono[] = cisternas.map(c => ({ clave: String(c.id), titulo: c.placa, bloques: [] }));
  const porClave = new Map(filas.map(f => [f.clave, f]));
  for (const v of vivos) {
    const clave = v.cisternaId ? String(v.cisternaId) : '';
    let fila = porClave.get(clave);
    if (!fila) {
      fila = { clave, titulo: clave ? `Cisterna #${clave}` : 'Sin cisterna', bloques: [] };
      porClave.set(clave, fila);
      filas.push(fila);
    }
    fila.bloques.push(bloque(v));
  }
  /* «Sin cisterna» siempre al final, aunque aparezca antes que una cisterna
     retirada: es un grupo de pendientes, no una cisterna más. */
  filas.sort((a, b) => Number(a.clave === '') - Number(b.clave === ''));

  return { filas, conflictos: vivos.flatMap(conflictosDe) };
}
