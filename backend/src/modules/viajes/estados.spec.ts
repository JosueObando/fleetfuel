import { FLUJO_VIAJE, EN_MARCHA, PLANIFICABLE } from './estados';

/*
 * La máquina de estados del viaje, contra el §8.2 del PRD.
 *
 * Estas pruebas están escritas DESDE EL PRD, no desde la tabla que hay en
 * `estados.ts`. La diferencia importa: una prueba derivada de la
 * implementación sólo confirma que el código hace lo que hace, y habría pasado
 * igual de verde con la tabla equivocada.
 *
 * Y hacen falta aquí y no en la base de datos porque la base NO PUEDE
 * comprobarlas. `viajes` tiene seis restricciones CHECK y cero triggers, y una
 * CHECK no ve el valor ANTERIOR de la fila: puede exigir que el estado sea uno
 * de los válidos, nunca que la transición lo sea. Es el único sitio donde vive
 * esta regla.
 */

/** §8.2, literal y en orden. */
const CAMINO_DEL_PRD = [
  'borrador',
  'programado',
  'autorizado',
  'desplazamiento_terminal',
  'espera_carga',
  'cargando',
  'cargado',
  'transito_estacion',
  'descargando',
  'retornando',
  'pendiente_liquidacion',
  'cerrado',
];

describe('el camino que describe el PRD', () => {
  it('existe entero: los doce estados están declarados', () => {
    for (const estado of CAMINO_DEL_PRD) {
      expect(Object.keys(FLUJO_VIAJE)).toContain(estado);
    }
  });

  it('se puede recorrer de principio a fin, paso a paso', () => {
    // Si alguien rompe un eslabón, el viaje se queda atascado a mitad de la
    // operación y no hay forma de cerrarlo. Esta es la prueba que lo detecta.
    for (let i = 0; i < CAMINO_DEL_PRD.length - 1; i++) {
      const desde = CAMINO_DEL_PRD[i];
      const hasta = CAMINO_DEL_PRD[i + 1];
      expect(FLUJO_VIAJE[desde]).toContain(hasta);
    }
  });

  it('termina: `cerrado` no lleva a ninguna parte', () => {
    expect(FLUJO_VIAJE.cerrado).toEqual([]);
  });
});

describe('integridad del grafo', () => {
  it('ninguna transición apunta a un estado que no existe', () => {
    // Un destino mal escrito —`programando` por `programado`— no da ningún
    // error: simplemente hace que esa transición no funcione nunca, y se
    // descubre operando.
    const conocidos = new Set(Object.keys(FLUJO_VIAJE));
    for (const [desde, destinos] of Object.entries(FLUJO_VIAJE)) {
      for (const hasta of destinos) {
        expect({ desde, hasta, existe: conocidos.has(hasta) })
          .toEqual({ desde, hasta, existe: true });
      }
    }
  });

  it('todos los estados son alcanzables desde `borrador`', () => {
    // Un estado al que no llega nadie es código muerto que parece vivo.
    const visitados = new Set<string>(['borrador']);
    const cola = ['borrador'];
    while (cola.length) {
      for (const siguiente of FLUJO_VIAJE[cola.shift() as string] ?? []) {
        if (!visitados.has(siguiente)) { visitados.add(siguiente); cola.push(siguiente); }
      }
    }
    const huerfanos = Object.keys(FLUJO_VIAJE).filter(e => !visitados.has(e));
    expect(huerfanos).toEqual([]);
  });

  it('sólo `cerrado` y `cancelado` son finales', () => {
    const finales = Object.entries(FLUJO_VIAJE)
      .filter(([, destinos]) => destinos.length === 0)
      .map(([estado]) => estado)
      .sort();
    expect(finales).toEqual(['cancelado', 'cerrado']);
  });
});

describe('la frontera de la autorización', () => {
  it('antes de autorizar se puede volver atrás', () => {
    // Mientras nadie se ha movido, replanificar es normal.
    expect(FLUJO_VIAJE.programado).toContain('borrador');
  });

  it('después de autorizar NO se vuelve a la planificación', () => {
    // El camión ya salió: «volver a borrador» dejaría un viaje en la calle sin
    // respaldo en el sistema.
    const haciaAtras = new Set(['borrador', 'programado']);
    for (const estado of EN_MARCHA) {
      const retrocesos = (FLUJO_VIAJE[estado] ?? []).filter(d => haciaAtras.has(d));
      expect({ estado, retrocesos }).toEqual({ estado, retrocesos: [] });
    }
  });

  it('EN_MARCHA es exactamente lo que hay desde `autorizado` en adelante', () => {
    // Es la comprobación que evita que la regla viva en DOS sitios que se
    // pueden desincronizar. Si alguien añade un estado al flujo y olvida
    // EN_MARCHA, ese viaje aceptaría cambiar de cisterna en plena carretera.
    const desdeAutorizado = new Set<string>();
    const cola = ['autorizado'];
    while (cola.length) {
      const actual = cola.shift() as string;
      if (desdeAutorizado.has(actual)) continue;
      desdeAutorizado.add(actual);
      cola.push(...(FLUJO_VIAJE[actual] ?? []));
    }
    desdeAutorizado.delete('cancelado');   // cancelado se alcanza desde todas partes
    expect([...EN_MARCHA].sort()).toEqual([...desdeAutorizado].sort());
  });

  it('PLANIFICABLE y EN_MARCHA no se solapan, y juntos no dejan huecos', () => {
    for (const estado of PLANIFICABLE) expect(EN_MARCHA.has(estado)).toBe(false);
    const cubiertos = new Set([...PLANIFICABLE, ...EN_MARCHA, 'cancelado']);
    expect(Object.keys(FLUJO_VIAJE).filter(e => !cubiertos.has(e))).toEqual([]);
  });
});

describe('cancelar', () => {
  it('se puede en toda la planificación y hasta que la cisterna se llena', () => {
    for (const estado of ['borrador', 'programado', 'autorizado',
                          'desplazamiento_terminal', 'espera_carga', 'cargando']) {
      expect(FLUJO_VIAJE[estado]).toContain('cancelado');
    }
  });

  it('DEJA de poder cancelarse en cuanto el viaje va cargado', () => {
    // Esta prueba fija una decisión que hoy sólo estaba implícita en la tabla,
    // y que conviene tener a la vista: con combustible a bordo ya no hay
    // «cancelar», sólo seguir hasta liquidar. Si algún día una avería obliga a
    // abortar un viaje cargado, ESTA prueba es la que hay que cambiar — y ese
    // cambio tiene consecuencias, porque el producto ya salió de la terminal y
    // tiene que volver a cuadrar en algún sitio.
    for (const estado of ['cargado', 'transito_estacion', 'descargando',
                          'retornando', 'pendiente_liquidacion']) {
      expect(FLUJO_VIAJE[estado]).not.toContain('cancelado');
    }
  });
});
