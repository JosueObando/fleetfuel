'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import {
  instantaneaDeSesion, sesionDelServidor, suscribirseASesion,
} from '@/api/cliente';
import estilos from './PuertaDeSesion.module.css';

/**
 * Lo único que decide si una pantalla se pinta o no.
 *
 * POR QUÉ ESTÁ SUELTA Y NO DENTRO DE `ShellApp`
 *
 * Vivía dentro del shell, así que sólo protegía lo que llevaba su navegación.
 * `/tablero` tiene su propio shell de tres columnas y quedó sin puerta: hasta
 * el 2026-09-12 se servía en producción a cualquiera que llegara sin enlace, y
 * encima era la primera pantalla del dominio. Copiar la comprobación en su
 * layout habría dejado dos puertas, y dos puertas divergen — la que se olvide
 * de actualizar es la que deja pasar.
 *
 * LA SESIÓN SE LEE COMO ALMACÉN EXTERNO, Y NO ES UN DETALLE
 *
 * `localStorage` cambia por caminos que React no ve —otra pestaña, un 401 que
 * la limpia a mitad de una petición—. Con `useSyncExternalStore` la puerta es
 * REACTIVA: cerrar sesión en una pestaña echa a las demás.
 */
export function PuertaDeSesion({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const sesion = useSyncExternalStore(
    suscribirseASesion, instantaneaDeSesion, sesionDelServidor);

  /* El salto sí es un efecto: es una acción sobre el navegador, no un estado.
     Pero NO puede mirar `sesion`, y eso costó un recorrido en rojo: durante la
     hidratación React devuelve a propósito la instantánea DEL SERVIDOR —siempre
     nula, que es lo que evita el desajuste—, y los efectos corren en ese primer
     commit. Mirando `sesion` se redirigía a todo el mundo con la sesión intacta.

     Así que pregunta al ALMACÉN. Un efecto sólo corre en el cliente, donde
     `localStorage` existe y la respuesta es la verdadera. `sesion` se queda como
     dependencia porque es la señal de que algo cambió. */
  useEffect(() => {
    if (!instantaneaDeSesion()) router.replace('/entrar');
  }, [sesion, router]);

  /* Hasta que haya sesión no se pinta nada: si se pintara antes, quien no ha
     entrado vería un instante la pantalla entera y luego el salto — y ese
     instante basta para leerla. */
  if (!sesion) return <div className={estilos.cargando}>Comprobando la sesión…</div>;

  return <>{children}</>;
}
