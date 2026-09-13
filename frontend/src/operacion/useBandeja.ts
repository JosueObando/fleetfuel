'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ErrorApi } from '@/api/cliente';
import type { Fila } from '@/api/tipos';

export const mensajeDeError = (e: unknown, porDefecto: string) =>
  e instanceof ErrorApi ? e.message : porDefecto;

/**
 * La carga de una bandeja: lo que espera una decisión y se recarga tras tomarla.
 *
 * Existía copiada en solicitudes de ruta y iba a copiarse en gastos, con la
 * parte que se olvida al copiar: la guarda `vigente`. Resolver recarga la
 * lista; resolver dos seguidas lanza dos recargas, y si la PRIMERA contesta la
 * última volvería a enseñar como pendiente lo que ya se resolvió — y alguien lo
 * resolvería otra vez. Las pruebas de eso viven en `Solicitudes.spec.tsx`.
 *
 * Y los datos se guardan JUNTO a la ruta que los pidió: cuando la ruta cambia
 * —otra pestaña de liquidaciones—, mientras llega la respuesta nueva no se
 * enseña la lista vieja bajo el título nuevo (`Liquidaciones.spec.tsx`).
 */
export function useBandeja(ruta: string, siFalla: string) {
  const [cargado, setCargado] = useState<{ ruta: string; filas: Fila[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vigente = true;
    api.listar<Fila>(ruta)
      .then(f => { if (vigente) { setCargado({ ruta, filas: f }); setError(null); } })
      .catch(e => {
        if (!vigente) return;
        setError(mensajeDeError(e, siFalla));
        setCargado({ ruta, filas: [] });
      });
    return () => { vigente = false; };
  }, [ruta, siFalla, version]);

  const recargar = useCallback(() => setVersion(v => v + 1), []);
  const filas = cargado?.ruta === ruta ? cargado.filas : null;
  return { filas, error, setError, recargar };
}
