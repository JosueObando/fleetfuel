const PREFIJO_IPV4_MAPEADA = '::ffff:';

/**
 * Node entrega las IPv4 MAPEADAS en IPv6 cuando el socket es de doble pila:
 * `::ffff:10.0.0.19` en vez de `10.0.0.19`. Es el mismo detalle que obliga a
 * `proxy-de-confianza.spec.ts` a fijar la equivalencia para `trust proxy`.
 *
 * Muerde en los dos sitios donde se guarda una dirección, y por la misma razón:
 * las dos escrituras no se parecen textualmente. En la columna `inet` de
 * `intentos_login` son familias distintas que no comparan entre sí; en los
 * registros de Loki son dos cadenas distintas que ningún filtro agrupa. En
 * ambos casos el síntoma es cero resultados, que se lee como «no pasó nada».
 *
 * Vive en `common/` y no dentro de un módulo porque la usan dos que no deberían
 * conocerse: el registro de intentos fallidos (auth) y el de peticiones HTTP.
 */
export function normalizarIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return ip.startsWith(PREFIJO_IPV4_MAPEADA) ? ip.slice(PREFIJO_IPV4_MAPEADA.length) : ip;
}
