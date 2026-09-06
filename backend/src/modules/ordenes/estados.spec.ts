import { FLUJO_ORDEN, EXIGEN_MOTIVO } from './estados';

/*
 * La máquina de estados de la orden, contra el §8.1 del PRD.
 *
 * Escritas desde el PRD, no desde la tabla: si se derivaran de la
 * implementación sólo confirmarían que el código hace lo que hace.
 */

/** §8.1 «Estados de una orden», el camino principal, literal y en orden. */
const CAMINO_DEL_PRD = [
  'recibida', 'validada', 'planificada', 'asignada', 'en_carga', 'cargada',
  'en_transito', 'entrega_parcial', 'entregada', 'conciliada', 'cerrada',
];

/** §8.1 «Estados alternos». */
const ALTERNOS = ['rechazada', 'cancelada', 'suspendida', 'con_incidencia'];

describe('el camino que describe el PRD', () => {
  it('están los once del camino principal y los cuatro alternos', () => {
    for (const estado of [...CAMINO_DEL_PRD, ...ALTERNOS]) {
      expect(Object.keys(FLUJO_ORDEN)).toContain(estado);
    }
  });

  it('se recorre entero, paso a paso', () => {
    for (let i = 0; i < CAMINO_DEL_PRD.length - 1; i++) {
      expect(FLUJO_ORDEN[CAMINO_DEL_PRD[i]]).toContain(CAMINO_DEL_PRD[i + 1]);
    }
  });

  it('se puede entregar del todo sin pasar por «entrega parcial»', () => {
    // El PRD la dibuja en línea, pero una entrega completa no es parcial
    // primero. Si este atajo no existiera, toda orden normal tendría que
    // mentir pasando por un estado que no ocurrió.
    expect(FLUJO_ORDEN.en_transito).toContain('entregada');
  });
});

describe('integridad del grafo', () => {
  it('ninguna transición apunta a un estado inexistente', () => {
    const conocidos = new Set(Object.keys(FLUJO_ORDEN));
    for (const [desde, destinos] of Object.entries(FLUJO_ORDEN)) {
      for (const hasta of destinos) {
        expect({ desde, hasta, existe: conocidos.has(hasta) }).toEqual({ desde, hasta, existe: true });
      }
    }
  });

  it('todos los estados son alcanzables desde «recibida»', () => {
    const visitados = new Set(['recibida']);
    const cola = ['recibida'];
    while (cola.length) {
      for (const s of FLUJO_ORDEN[cola.shift() as string] ?? []) {
        if (!visitados.has(s)) { visitados.add(s); cola.push(s); }
      }
    }
    expect(Object.keys(FLUJO_ORDEN).filter(e => !visitados.has(e))).toEqual([]);
  });

  it('sólo cerrada, rechazada y cancelada son terminales', () => {
    const finales = Object.entries(FLUJO_ORDEN)
      .filter(([, d]) => d.length === 0).map(([e]) => e).sort();
    expect(finales).toEqual(['cancelada', 'cerrada', 'rechazada']);
  });
});

describe('los estados de los que se puede volver', () => {
  it('«suspendida» y «con incidencia» devuelven al flujo, no son callejones', () => {
    // Si fueran terminales, cualquier incidencia mataría la orden y habría que
    // rehacerla entera — y con ella se perdería su historia.
    expect(FLUJO_ORDEN.suspendida).toContain('validada');
    expect(FLUJO_ORDEN.con_incidencia).toContain('validada');
  });

  it('una orden cerrada NO se reabre', () => {
    // Reabrirla borraría el sentido de «cerrada» para la conciliación.
    expect(FLUJO_ORDEN.cerrada).toEqual([]);
  });

  it('desde en_carga en adelante ya no se puede cancelar', () => {
    // A partir de que el producto entra en la cisterna, la salida no es
    // «cancelar» sino registrar la incidencia: el volumen ya se movió.
    for (const estado of ['en_carga', 'cargada', 'en_transito', 'entrega_parcial',
                          'entregada', 'conciliada']) {
      expect(FLUJO_ORDEN[estado]).not.toContain('cancelada');
    }
  });
});

describe('los estados que exigen justificación', () => {
  it('todos existen en el flujo', () => {
    // Un estado en EXIGEN_MOTIVO que no exista en FLUJO_ORDEN sería una regla
    // que nunca se aplica, y nada lo delataría.
    for (const estado of EXIGEN_MOTIVO) {
      expect(Object.keys(FLUJO_ORDEN)).toContain(estado);
    }
  });

  it('son exactamente los que interrumpen el curso normal', () => {
    // Los cuatro «alternos» del §8.1: los que sacan la orden de su camino.
    // Que coincidan no es casualidad, es la regla — y esta prueba la fija.
    expect([...EXIGEN_MOTIVO].sort()).toEqual([...ALTERNOS].sort());
  });

  it('ningún estado del camino principal exige motivo', () => {
    // Pedir justificación para avanzar por el flujo normal convertiría el
    // motivo en un campo que se rellena con cualquier cosa por costumbre.
    for (const estado of CAMINO_DEL_PRD) {
      expect(EXIGEN_MOTIVO.has(estado)).toBe(false);
    }
  });
});
