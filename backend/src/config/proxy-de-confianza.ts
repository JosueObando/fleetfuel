import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

/**
 * Convierte el valor de `PROXIES_DE_CONFIANZA` en la lista que espera Express.
 *
 * Vive aparte de `main.ts` —y no dentro de él— para que se pueda probar: el
 * fallo que previene es silencioso, así que la única forma de saber que sigue
 * funcionando es afirmarlo en una prueba. Ver `proxy-de-confianza.spec.ts`.
 */
export function listaDeProxiesDeConfianza(valor: string | undefined): string[] {
  return (valor ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Detrás de un proxy inverso, `@Ip()` devuelve la IP del PROXY, no la del
 * cliente: sin esto, la auditoría registraría cada inicio de sesión como
 * proveniente del proxy y la traza de «quién entró desde dónde» quedaría
 * destruida en silencio, sin un solo error.
 *
 * Se confía en una lista explícita de proxies y NUNCA en `true`. Con `true`,
 * Express acepta el `X-Forwarded-For` de cualquiera: un cliente podría
 * falsificar su propia IP en la auditoría, que es peor que no registrarla.
 */
export function configurarProxyDeConfianza(
  app: NestExpressApplication, config: ConfigService, log: Logger,
) {
  const lista = listaDeProxiesDeConfianza(config.get<string>('proxiesDeConfianza'));

  if (lista.length === 0) {
    log.log('Sin proxy de confianza: se usa la IP del socket. Correcto si no hay proxy delante.');
    return;
  }
  app.set('trust proxy', lista);
  log.log(`Proxies de confianza: ${lista.join(', ')} — se leerá X-Forwarded-For de ellos.`);
}
