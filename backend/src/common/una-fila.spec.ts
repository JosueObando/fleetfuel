import { unaFila } from './una-fila';

/*
 * TypeORM devuelve dos formas distintas según la sentencia, y el fallo que
 * produce la diferencia es mudo: `const [x] = await query(UPDATE … RETURNING)`
 * captura el array de filas y no la fila, y eso se pasea por el sistema hasta
 * que alguien lee una propiedad.
 */

const FILA = { id: '1', nombre: 'Cliente' };

describe('unaFila', () => {
  it('desenvuelve la forma de INSERT: [fila]', () => {
    expect(unaFila([FILA])).toEqual(FILA);
  });

  it('desenvuelve la forma de UPDATE y DELETE: [[fila], contador]', () => {
    expect(unaFila([[FILA], 1])).toEqual(FILA);
  });

  it('no confunde una fila cuyo primer valor es un array', () => {
    // El discriminante es que resultado[0] sea un ARRAY. Una fila con una
    // columna de tipo array no lo es: sigue siendo un objeto.
    const conArray = { id: '1', etiquetas: ['a', 'b'] };
    expect(unaFila([conArray])).toEqual(conArray);
  });

  it('sin filas devuelve undefined, no revienta', () => {
    // Un UPDATE que no encuentra nada devuelve [[], 0]. Quien llame decide qué
    // hacer con eso; lo que no puede es explotar aquí.
    expect(unaFila([[], 0])).toBeUndefined();
    expect(unaFila([])).toBeUndefined();
  });
});
