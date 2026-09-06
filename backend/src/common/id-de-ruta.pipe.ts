import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/**
 * Todos los identificadores del sistema son BIGINT y viajan como cadena —un
 * bigint no cabe en el `number` de JavaScript sin perder precisión, así que
 * convertirlos sería peor que dejarlos como texto—. El problema es que hasta
 * ahora llegaban a Postgres tal cual: un `GET /api/clientes/abc` acababa en
 * `invalid input syntax for type bigint` y salía como **500**.
 *
 * Eso tenía dos costes, y el segundo no es evidente. El primero, que un error
 * del cliente se devolvía como error del servidor. El segundo, que
 * `ff-errores-5xx` vigila la tasa de 5xx de producción: cualquiera pidiendo
 * rutas con identificadores inventados —un rastreador, un enlace roto— hacía
 * saltar la alerta. Un canal que suena por basura ajena acaba silenciado, y un
 * canal silenciado es peor que no tenerlo porque parece que está.
 *
 * Se registra como APP_PIPE en el módulo y no en `main.ts` a propósito: así
 * aplica también en las pruebas, que montan el AppModule por su cuenta. Un
 * guardián que sólo existe en producción es un guardián que nadie prueba.
 */

/** Hasta 18 dígitos: siempre por debajo del máximo de un bigint, así que ni
 *  siquiera un número enorme puede desbordar y volver a producir un 500. */
const ID_VALIDO = /^\d{1,18}$/;

@Injectable()
export class IdDeRutaPipe implements PipeTransform<string> {
  transform(valor: string, meta: ArgumentMetadata): string {
    // Sólo parámetros de ruta. El cuerpo lo validan los DTO con `EsId`, que
    // pueden dar un mensaje por campo; aquí no se sabría de cuál se habla.
    if (meta.type !== 'param' || !meta.data) return valor;
    if (!/^(id|[a-zA-Z]+Id)$/.test(meta.data)) return valor;
    if (!ID_VALIDO.test(valor)) {
      // Sin repetir el valor recibido: la ruta ya está en la petición, y no
      // hace falta devolver texto ajeno en la respuesta.
      throw new BadRequestException(`El parámetro «${meta.data}» no es un identificador válido`);
    }
    return valor;
  }
}
