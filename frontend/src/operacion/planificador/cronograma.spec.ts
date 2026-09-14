import { cronograma, lunesDe, sumarDias, ventanaDe, type ViajePlan } from './cronograma';

/*
 * §15.3 · El planificador: filas por cisterna, columnas por día, bloques de
 * viaje y los conflictos de asignación.
 *
 * QUÉ ES UN CONFLICTO AQUÍ, Y QUÉ NO
 *
 * Dos viajes activos de la misma cisterna o del mismo conductor que se pisan
 * NO pueden existir: la exclusión del §5.1 los rechaza en la base. Marcar
 * «solapes» sólo encontraría viajes CERRADOS, que ya no ocupan nada, y una
 * alarma que siempre es falsa enseña a no mirar las alarmas.
 *
 * Lo que la exclusión NO ve es lo que el planificador tiene que enseñar: un
 * viaje sin cisterna o sin conductor no reserva a nadie, uno sin fin ocupa su
 * cisterna para siempre, y uno retrasado tiene ocupada una franja que ya pasó.
 */

const V = (extra: Partial<ViajePlan> = {}): ViajePlan => ({
  id: '1', codigoViaje: 'V-001', estado: 'programado',
  cisternaId: '3', conductorId: '4', conductor: 'Ana Pérez',
  fechaProgramada: '2027-03-02T00:00:00.000Z', fechaInicio: null, fechaFin: '2027-03-03T00:00:00.000Z',
  destinos: ['Estación Norte'], retrasado: false,
  ...extra,
});
const CISTERNAS = [{ id: '3', placa: 'CL-003' }, { id: '8', placa: 'CL-008' }];
// Lunes 1 de marzo de 2027, siete días.
const SEMANA = ventanaDe('2027-03-01');

describe('la ventana', () => {
  it('siete días desde el que se pide, en UTC como el resto de fechas del viaje', () => {
    expect(SEMANA.desde).toBe('2027-03-01T00:00:00.000Z');
    expect(SEMANA.hasta).toBe('2027-03-08T00:00:00.000Z');
    expect(SEMANA.dias).toEqual(['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04',
                                 '2027-03-05', '2027-03-06', '2027-03-07']);
  });

  it('la semana empieza en lunes, sea cual sea el día que se abra', () => {
    expect(lunesDe('2027-03-04')).toBe('2027-03-01'); // jueves
    expect(lunesDe('2027-03-07')).toBe('2027-03-01'); // domingo: sigue siendo su semana
    expect(lunesDe('2027-03-01')).toBe('2027-03-01');
  });

  it('avanzar y retroceder cruza meses', () => {
    expect(sumarDias('2027-02-22', 7)).toBe('2027-03-01');
    expect(sumarDias('2027-03-01', -7)).toBe('2027-02-22');
  });
});

describe('las filas', () => {
  it('una por cisterna, también las que no tienen viajes: se ve lo que está LIBRE', () => {
    const { filas } = cronograma([V()], CISTERNAS, SEMANA);
    expect(filas.map(f => f.titulo)).toEqual(['CL-003', 'CL-008']);
    expect(filas[1].bloques).toEqual([]);
  });

  it('los viajes sin cisterna van en su propia fila, al final', () => {
    const { filas } = cronograma([V({ cisternaId: null })], CISTERNAS, SEMANA);
    expect(filas.map(f => f.titulo)).toEqual(['CL-003', 'CL-008', 'Sin cisterna']);
    expect(filas[2].bloques).toHaveLength(1);
  });

  it('sin viajes sin cisterna, esa fila no existe', () => {
    expect(cronograma([V()], CISTERNAS, SEMANA).filas.map(f => f.titulo)).not.toContain('Sin cisterna');
  });

  it('una cisterna que ya no está en el catálogo no se pierde: fila con su número', () => {
    // Dada de baja con viajes vivos: esconderlos sería esconder justo el problema.
    const { filas } = cronograma([V({ cisternaId: '99' })], CISTERNAS, SEMANA);
    expect(filas.map(f => f.titulo)).toContain('Cisterna #99');
  });

  it('«Sin cisterna» va al final aunque su viaje salga antes que el de una cisterna retirada', () => {
    const { filas } = cronograma([
      V({ id: '1', cisternaId: null, fechaProgramada: '2027-03-01T00:00:00.000Z' }),
      V({ id: '2', cisternaId: '99', fechaProgramada: '2027-03-04T00:00:00.000Z', fechaFin: '2027-03-05T00:00:00.000Z' }),
    ], CISTERNAS, SEMANA);
    expect(filas.map(f => f.titulo)).toEqual(['CL-003', 'CL-008', 'Cisterna #99', 'Sin cisterna']);
  });

  it('los cancelados no ocupan: no se pintan', () => {
    const { filas } = cronograma([V({ estado: 'cancelado' })], CISTERNAS, SEMANA);
    expect(filas[0].bloques).toEqual([]);
  });

  it('dentro de una fila, los bloques van en orden de salida', () => {
    const { filas } = cronograma([
      V({ id: '2', codigoViaje: 'V-002', fechaProgramada: '2027-03-05T00:00:00.000Z', fechaFin: '2027-03-06T00:00:00.000Z' }),
      V({ id: '1' }),
    ], CISTERNAS, SEMANA);
    expect(filas[0].bloques.map(b => b.viaje.id)).toEqual(['1', '2']);
  });
});

describe('dónde cae cada bloque', () => {
  it('posición y ancho en proporción a la semana', () => {
    // Del día 2 (índice 1) al 3: empieza en 1/7 y ocupa 1/7.
    const [b] = cronograma([V()], CISTERNAS, SEMANA).filas[0].bloques;
    expect(b.izquierda).toBeCloseTo(100 / 7, 5);
    expect(b.ancho).toBeCloseTo(100 / 7, 5);
    expect(b.cortaInicio).toBe(false);
    expect(b.cortaFin).toBe(false);
  });

  it('un viaje ya arrancado se pinta desde su SALIDA REAL', () => {
    const [b] = cronograma([V({ estado: 'cargando', fechaInicio: '2027-03-02T12:00:00.000Z' })],
      CISTERNAS, SEMANA).filas[0].bloques;
    expect(b.izquierda).toBeCloseTo((1.5 / 7) * 100, 5);
  });

  it('lo que empezó antes de la semana se recorta al borde, y lo dice', () => {
    const [b] = cronograma([V({ fechaProgramada: '2027-02-27T00:00:00.000Z' })], CISTERNAS, SEMANA).filas[0].bloques;
    expect(b.izquierda).toBe(0);
    expect(b.ancho).toBeCloseTo((2 / 7) * 100, 5);
    expect(b.cortaInicio).toBe(true);
  });

  it('sin fin, el bloque llega al borde derecho y se marca cortado', () => {
    const [b] = cronograma([V({ fechaFin: null })], CISTERNAS, SEMANA).filas[0].bloques;
    expect(b.izquierda + b.ancho).toBeCloseTo(100, 5);
    expect(b.cortaFin).toBe(true);
  });

  it('el color sale del momento del viaje, no de cada uno de sus trece estados', () => {
    const grupo = (estado: string) => cronograma([V({ estado })], CISTERNAS, SEMANA).filas[0].bloques[0].grupo;
    expect(grupo('borrador')).toBe('planificacion');
    expect(grupo('programado')).toBe('planificacion');
    expect(grupo('autorizado')).toBe('autorizado');
    expect(grupo('transito_estacion')).toBe('enMarcha');
    expect(grupo('pendiente_liquidacion')).toBe('enMarcha');
    expect(grupo('cerrado')).toBe('cerrado');
  });
});

describe('los conflictos de asignación', () => {
  const tipos = (viajes: ViajePlan[]) => cronograma(viajes, CISTERNAS, SEMANA).conflictos.map(c => c.tipo);

  it('un viaje bien asignado no tiene ninguno', () => {
    expect(tipos([V()])).toEqual([]);
  });

  it('sin cisterna, sin conductor, sin fin y retrasado, cada uno con su texto', () => {
    const { conflictos } = cronograma([V({ cisternaId: null, conductorId: null, conductor: null, fechaFin: null,
                                           retrasado: true })], CISTERNAS, SEMANA);
    expect(conflictos.map(c => c.texto)).toEqual([
      'sin cisterna: no reserva ninguna',
      'sin conductor: no reserva a nadie',
      'sin fin previsto: ocupa su cisterna sin límite',
      'retrasado: debió salir el 2 de marzo',
    ]);
  });

  it('un viaje CERRADO ya no genera conflictos, aunque le falten datos', () => {
    // Lo que no se asignó en un viaje terminado es historia, no una decisión pendiente.
    expect(tipos([V({ estado: 'cerrado', conductorId: null, fechaFin: null })])).toEqual([]);
  });

  it('el retraso lo decide la API, no una fecha comparada aquí', () => {
    // Mismo criterio que el informe operativo: dos definiciones contarían distinto.
    expect(tipos([V({ fechaProgramada: '2020-01-01T00:00:00.000Z', retrasado: false })])).toEqual([]);
  });

  it('en orden de salida, para leerlos como una agenda', () => {
    const { conflictos } = cronograma([
      V({ id: '2', codigoViaje: 'V-002', fechaProgramada: '2027-03-05T00:00:00.000Z', fechaFin: null }),
      V({ id: '1', conductorId: null }),
    ], CISTERNAS, SEMANA);
    expect(conflictos.map(c => c.viaje.codigoViaje)).toEqual(['V-001', 'V-002']);
  });
});
