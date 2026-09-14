import { diaDeFin, finDelDia, inicioDelDia } from './fechas';

/*
 * Los dos días de un viaje, y por qué el de fin no es una medianoche más.
 *
 * `periodo` es `[inicio, fin)`: el fin NO está incluido. Mandar el día de fin
 * como su medianoche hacía que un viaje de un día —salida y fin el mismo día,
 * que es lo normal— tuviera un periodo VACÍO, y un rango vacío no se solapa con
 * nada: el viaje no reservaba ni la cisterna ni el conductor. 16 de los 29
 * viajes de desarrollo estaban así.
 *
 * Así que «Fin previsto: 1 de marzo» significa lo que lee una persona: el viaje
 * ocupa hasta el FINAL del 1 de marzo.
 */

describe('inicioDelDia', () => {
  it('es la medianoche UTC del día, el convenio de siempre del alta', () => {
    expect(inicioDelDia('2027-03-01')).toBe('2027-03-01T00:00:00.000Z');
  });
});

describe('finDelDia', () => {
  it('es el comienzo del día SIGUIENTE: el día elegido queda dentro', () => {
    expect(finDelDia('2027-03-01')).toBe('2027-03-02T00:00:00.000Z');
  });

  it('cruza meses y años sin perder un día', () => {
    expect(finDelDia('2027-02-28')).toBe('2027-03-01T00:00:00.000Z');
    expect(finDelDia('2027-12-31')).toBe('2028-01-01T00:00:00.000Z');
  });

  it('un viaje de un día tiene duración: fin posterior al inicio', () => {
    expect(finDelDia('2027-03-01') > inicioDelDia('2027-03-01')).toBe(true);
  });
});

describe('diaDeFin', () => {
  it('devuelve el último día OCUPADO, el que la persona eligió', () => {
    expect(diaDeFin('2027-03-02T00:00:00.000Z')).toBe('2027-03-01');
    expect(diaDeFin(finDelDia('2027-12-31'))).toBe('2027-12-31');
  });

  it('un fin con hora —creado por la API— cae en su propio día', () => {
    // Termina a las 8:00 del 1 de marzo: el 1 de marzo está ocupado.
    expect(diaDeFin('2027-03-01T08:00:00.000Z')).toBe('2027-03-01');
  });

  it('sin fin, el campo queda vacío', () => {
    expect(diaDeFin(null)).toBe('');
    expect(diaDeFin(undefined)).toBe('');
  });
});
