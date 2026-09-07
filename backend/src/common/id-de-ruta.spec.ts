import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { IdDeRutaPipe } from './id-de-ruta.pipe';

/*
 * El pipe que impide que un identificador con basura salga como 500.
 *
 * Todos los ids del sistema son BIGINT y llegan a Postgres tal cual; un `abc`
 * produce «invalid input syntax for type bigint», que sale como error del
 * SERVIDOR por un error del CLIENTE. Además de mentir sobre de quién es la
 * culpa, un 500 es la respuesta que los monitores despiertan de madrugada.
 *
 * Lo que aquí faltaba probar es lo contrario de su trabajo: qué DEJA pasar. Un
 * pipe global que se pase de celoso rompe rutas que no tienen nada que ver, y
 * eso no se ve hasta que alguien añade un parámetro con otro nombre.
 */
const meta = (tipo: string, nombre?: string): ArgumentMetadata =>
  ({ type: tipo, data: nombre } as ArgumentMetadata);

describe('IdDeRutaPipe', () => {
  const pipe = new IdDeRutaPipe();

  it('deja pasar un identificador normal', () => {
    expect(pipe.transform('42', meta('param', 'id'))).toBe('42');
    expect(pipe.transform('907', meta('param', 'detalleOrdenId'))).toBe('907');
  });

  it('rechaza basura donde se espera un id', () => {
    expect(() => pipe.transform('abc', meta('param', 'id')))
      .toThrow(BadRequestException);
    expect(() => pipe.transform("1; DROP TABLE viajes", meta('param', 'viajeId')))
      .toThrow(/no es un identificador válido/);
  });

  it('no repite el valor recibido en el mensaje', () => {
    // Devolver texto ajeno en la respuesta es cómo un mensaje de error se
    // convierte en un reflejo de lo que mandó quien ataca.
    try {
      pipe.transform('<script>x</script>', meta('param', 'id'));
      throw new Error('debió lanzar');
    } catch (e) {
      expect((e as Error).message).not.toContain('script');
      expect((e as Error).message).toContain('id');
    }
  });

  it('NO toca los parámetros que no son de ruta', () => {
    // El cuerpo lo validan los DTO con `EsId`, que sí pueden decir de qué campo
    // hablan. Duplicarlo aquí daría dos mensajes distintos para el mismo error.
    expect(pipe.transform('abc', meta('body', 'id'))).toBe('abc');
    expect(pipe.transform('abc', meta('query', 'id'))).toBe('abc');
  });

  it('NO toca los parámetros de ruta que no son identificadores', () => {
    // La rama que no cubría nadie, y la que rompe cosas ajenas si se equivoca:
    // un `:codigo` o un `:slug` tienen que pasar intactos aunque no sean
    // números. Un pipe global demasiado celoso rompe rutas que no tienen nada
    // que ver con esto.
    expect(pipe.transform('gasolina-95', meta('param', 'codigo'))).toBe('gasolina-95');
    expect(pipe.transform('abc', meta('param', 'nombre'))).toBe('abc');
    // `Id` en medio no cuenta: sólo `id` o `algoId`.
    expect(pipe.transform('abc', meta('param', 'Identificador'))).toBe('abc');
  });

  it('sin nombre de parámetro no hay nada que comprobar', () => {
    expect(pipe.transform('abc', meta('param', undefined))).toBe('abc');
  });
});
