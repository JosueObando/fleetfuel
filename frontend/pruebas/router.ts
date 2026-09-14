import { useSyncExternalStore } from 'react';

/*
 * Un `next/navigation` de prueba que SÍ navega.
 *
 * El doble habitual —`replace: jest.fn()` y unos `searchParams` fijos— basta
 * cuando la prueba sólo mira qué URL se escribe. No basta cuando la pantalla
 * LEE su estado de la URL: con un `replace` que no cambia nada, una pantalla que
 * escribiera `?viaje=1` y nunca volviera a leerlo pasaría todas las pruebas de
 * «elegir un viaje abre su detalle» sin abrir nada.
 *
 * Aquí `replace` cambia la consulta y avisa a quien la lee, igual que el router
 * de verdad. Uso:
 *
 *     jest.mock('next/navigation', () => jest.requireActual('<ruta>/pruebas/router'));
 *     import { irA, reemplazos, reiniciarUrl } from '<ruta>/pruebas/router';
 *     beforeEach(() => reiniciarUrl('/operacion/despacho'));
 */

let ruta = '/';
let consulta = new URLSearchParams();
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach(f => f());

/** Cada `router.replace` que hizo la pantalla, con sus argumentos. */
export const reemplazos = jest.fn();
/** Cada `router.push`: navegar a OTRA pantalla, que apila historial. */
export const navegaciones = jest.fn();

/** Deja la URL como si se hubiera abierto `url` en la barra. */
export function irA(url: string) {
  const [camino, q = ''] = url.split('?');
  ruta = camino;
  consulta = new URLSearchParams(q);
  avisar();
}

export function reiniciarUrl(url = '/') {
  reemplazos.mockClear();
  navegaciones.mockClear();
  irA(url);
}

export const useRouter = () => ({
  replace: (url: string, opciones?: unknown) => { reemplazos(url, opciones); irA(url); },
  push: (url: string) => { navegaciones(url); irA(url); },
});

export const usePathname = () => useSyncExternalStore(suscribir, () => ruta);
export const useSearchParams = () => useSyncExternalStore(suscribir, () => consulta);

function suscribir(f: () => void) {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
}
