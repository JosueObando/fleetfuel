'use client';

import { useEffect } from 'react';

/**
 * Lanza la carga inicial de una pantalla y la repite si su función cambia.
 *
 * POR QUÉ EXISTE
 *
 * Estas cinco líneas estaban copiadas en cinco pantallas:
 *
 *     const cargar = useCallback(async () => { … setFilas(await api.listar(…)) }, []);
 *     useEffect(() => { void cargar(); }, [cargar]);
 *
 * Y con ellas, cinco veces el mismo aviso de `react-hooks/set-state-in-effect`.
 *
 * EL AVISO ERA UN FALSO POSITIVO, Y CONVIENE SABER POR QUÉ
 *
 * La regla existe para impedir un `setState` SÍNCRONO dentro de un efecto, que
 * provoca un render en cascada. Aquí el `setState` ocurre después de un
 * `await`: en otro turno del bucle de eventos, no en el cuerpo del efecto. El
 * analizador no puede ver a través de la función asíncrona y avisa igual.
 *
 * Donde la regla SÍ tenía razón —`if (!clienteId) { setEstaciones([]); return; }`
 * y el `if (leerSesion()) setListo(true)` del shell— no se silenció: se
 * arreglaron, derivando el valor y leyendo la sesión con `useSyncExternalStore`.
 *
 * LA CONDICIÓN QUE HAY QUE RESPETAR
 *
 * `cargar` puede llamar a `setState` **sólo después de un `await`**. Una versión
 * que empiece poniendo `setCargando(true)` de forma síncrona vuelve a ser
 * exactamente lo que la regla persigue, y este envoltorio lo taparía. Si hace
 * falta ese estado, se pone antes de llamar aquí o dentro del propio `await`.
 *
 * RESPUESTAS TARDÍAS
 *
 * `cargar` recibe `vigente()`, que pasa a falso en cuanto la función cambia o
 * la pantalla se desmonta. Una carga que dependa de algo que cambia —el viaje
 * que pide la URL— lo consulta antes de pintar, y la respuesta de la petición
 * anterior no pisa la nueva. Las cargas que no dependen de nada lo ignoran.
 */
export function useCargaInicial(cargar: (vigente: () => boolean) => Promise<unknown>): void {
  useEffect(() => {
    let vigente = true;
    void cargar(() => vigente);
    return () => { vigente = false; };
  }, [cargar]);
}
