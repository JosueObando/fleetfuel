import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Por qué falló el intento. Se guarda el motivo REAL, no el mensaje genérico
 * que se le devuelve al cliente: al de fuera se le dice «credenciales
 * inválidas» para no convertir el login en un oráculo de qué correos existen,
 * pero quien mira el registro necesita distinguir «ese correo no existe» de
 * «existe y falló la clave» — son ataques distintos y se responden distinto.
 */
export type MotivoDeFallo =
  | 'correo_desconocido'
  | 'clave_incorrecta'
  | 'usuario_suspendido'
  | 'mfa_ausente'
  | 'mfa_incorrecto'
  | 'mfa_sin_secreto';

export interface IntentoFallido {
  correo: string;
  motivo: MotivoDeFallo;
  ip?: string;
  empresaId?: string;
  usuarioId?: string;
}

const ANCHO_CORREO = 160;
const PREFIJO_IPV4_MAPEADA = '::ffff:';

/**
 * Node entrega las IPv4 MAPEADAS en IPv6 cuando el socket es de doble pila:
 * `::ffff:10.0.0.19` en vez de `10.0.0.19`. Es el mismo detalle que obliga a
 * `proxy-de-confianza.spec.ts` a fijar la equivalencia para `trust proxy`.
 *
 * Aquí muerde de otra forma. En el tipo `inet` de Postgres las dos escrituras
 * son familias DISTINTAS y no comparan entre sí, así que la tabla acabaría con
 * las dos mezcladas —limpias las que llegan por el proxy, mapeadas las
 * directas— y un `WHERE ip = '10.0.0.19'` devolvería sólo la mitad. Sin error:
 * cero filas, que se lee como «no hubo intentos».
 */
export function normalizarIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return ip.startsWith(PREFIJO_IPV4_MAPEADA) ? ip.slice(PREFIJO_IPV4_MAPEADA.length) : ip;
}

@Injectable()
export class IntentosLoginService {
  private readonly log = new Logger(IntentosLoginService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Escribe FUERA de cualquier transacción de petición, y eso es el punto.
   *
   * El interceptor de auditoría escribe dentro de la transacción para que el
   * rastro se revierta si la operación falla. Aquí es al revés: el rastro tiene
   * que sobrevivir precisamente porque la operación falló. Usar `dataSource`
   * directamente —y no el `manager` del contexto— hace que cada INSERT sea su
   * propia transacción, que confirma antes de que la excepción suba.
   *
   * Tampoco fija `app.empresa_id`, porque no siempre hay empresa que fijar:
   * `intentos_login` es la única tabla sin RLS, justamente por eso.
   */
  async registrarFallo(intento: IntentoFallido): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO intentos_login (correo, empresa_id, usuario_id, motivo, ip)
         VALUES ($1, $2, $3, $4, $5::inet)`,
        [
          // El DTO valida que sea un correo, pero no acota el largo: sin este
          // recorte un correo de 300 caracteres desbordaría el varchar(160), el
          // INSERT fallaría y el intento —justo el raro, el que más interesa—
          // sería el único que no quedara registrado.
          intento.correo.slice(0, ANCHO_CORREO),
          intento.empresaId ?? null,
          intento.usuarioId ?? null,
          intento.motivo,
          normalizarIp(intento.ip),
        ],
      );
    } catch (error) {
      // No puede tumbar el login: quien se equivocó de clave tiene que recibir
      // su 401 aunque este registro falle. Pero tampoco puede callar, que es
      // como se llegó a no tener registro ninguno. El único escenario real en
      // que esto salta es un despliegue a medias —la migración sin correr, el
      // GRANT sin dar—, porque si la base estuviera caída el login ya habría
      // fallado antes al resolver el correo.
      //
      // Mientras no exista la observabilidad del 0.6, este error vive sólo en
      // el log del contenedor. Es lo más ruidoso que hay hoy.
      this.log.error(
        `NO se pudo registrar un intento fallido (${intento.motivo}). ` +
        `El freno sigue puesto, pero este intento no deja rastro: ${(error as Error).message}`,
      );
    }
  }
}
