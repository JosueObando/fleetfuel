import { applyDecorators } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';

/**
 * Un identificador que viene en el CUERPO. Sustituye al `@IsString()` que
 * llevaban estos campos, que aceptaba «abc» y lo dejaba llegar hasta Postgres:
 * el bigint fallaba allí y la petición salía como 500 en vez de 400.
 *
 * El equivalente para los parámetros de ruta es `IdDeRutaPipe`.
 */
export const EsId = () =>
  applyDecorators(
    IsString(),
    Matches(/^\d{1,18}$/, { message: '$property no es un identificador válido' }),
  );
