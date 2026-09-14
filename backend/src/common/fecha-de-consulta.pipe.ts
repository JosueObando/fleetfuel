import { BadRequestException, PipeTransform } from '@nestjs/common';

/**
 * Una fecha de calendario opcional en la cadena de consulta de un informe.
 *
 * Termina en un `$1::date`, y con cualquier otra cosa Postgres lanza 22007 o
 * 22008 y sale como 500. Por qué eso importa más que la respuesta fea está en
 * `id-de-ruta.pipe.ts`: la alerta de 5xx de producción no distingue un fallo
 * nuestro de una fecha inventada por quien llama.
 *
 * No es global, al contrario que `IdDeRutaPipe`: no hay un nombre de parámetro
 * que diga «esto es una fecha» en todas las rutas. Se pone en cada `@Query`.
 */
const FORMA = /^(\d{4})-(\d{2})-(\d{2})$/;

export class FechaDeConsultaPipe implements PipeTransform<string | undefined> {
  transform(valor: string | undefined): string | undefined {
    if (valor === undefined || valor === '') return undefined;
    const partes = FORMA.exec(valor);
    // La forma no basta: el 30 de febrero la tiene. Se construye la fecha y se
    // comprueba que no se desbordó al mes siguiente.
    const valida = partes !== null && (() => {
      const [a, m, d] = partes.slice(1).map(Number);
      const f = new Date(Date.UTC(a, m - 1, d));
      return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
    })();
    if (!valida) {
      // Sin repetir el valor recibido, por lo mismo que en `IdDeRutaPipe`.
      throw new BadRequestException('La fecha no es una fecha válida (AAAA-MM-DD)');
    }
    return valor;
  }
}
