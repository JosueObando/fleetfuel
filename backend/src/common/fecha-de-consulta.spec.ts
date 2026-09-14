import { BadRequestException } from '@nestjs/common';
import { FechaDeConsultaPipe } from './fecha-de-consulta.pipe';

/*
 * La fecha de un informe llega en la cadena de consulta y termina en un
 * `$1::date`. Con cualquier otra cosa Postgres lanza 22007/22008 y sale un 500:
 * un error del cliente contado como del servidor, que es justo lo que vigila
 * `ff-errores-5xx` (ver `id-de-ruta.pipe.ts`).
 */
describe('FechaDeConsultaPipe', () => {
  const pipe = new FechaDeConsultaPipe();

  it('sin fecha, undefined: el informe decide su día por omisión', () => {
    expect(pipe.transform(undefined)).toBeUndefined();
    // `?fecha=` vacío es lo que manda un formulario con el campo sin rellenar.
    expect(pipe.transform('')).toBeUndefined();
  });

  it('deja pasar una fecha de calendario, incluido el 29 de febrero bisiesto', () => {
    expect(pipe.transform('2033-03-15')).toBe('2033-03-15');
    expect(pipe.transform('2032-02-29')).toBe('2032-02-29');
  });

  it('rechaza lo que no tiene forma de fecha', () => {
    for (const v of ['luna', '15/03/2033', '2033-3-15', '2033-03-15T00:00', ' 2033-03-15']) {
      expect(() => pipe.transform(v)).toThrow(BadRequestException);
    }
  });

  it('rechaza una fecha con forma correcta que no existe', () => {
    // La forma sola dejaría pasar el 30 de febrero, y Postgres lo rechaza igual.
    for (const v of ['2033-02-30', '2033-02-29', '2033-13-01', '2033-00-10', '2033-04-31']) {
      expect(() => pipe.transform(v)).toThrow(/no es una fecha válida/);
    }
  });

  it('no repite el valor recibido en el mensaje', () => {
    try {
      pipe.transform('<script>x</script>');
      throw new Error('debió lanzar');
    } catch (e) {
      // Sin esta línea la prueba pasaría con un pipe que no lanza: el «debió
      // lanzar» de arriba cae en este mismo catch y tampoco dice «script».
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as Error).message).not.toContain('script');
    }
  });
});
