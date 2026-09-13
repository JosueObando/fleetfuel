'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/api/cliente';
import type { Fila } from '@/api/tipos';
import { puedeDarPorBueno, useUsuarioActual } from '@/api/usuario-actual';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { Tabs } from '@/componentes/Tabs/Tabs';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from '../bandeja.module.css';
import { mensajeDeError, useBandeja } from '../useBandeja';

/**
 * §7.18 · Las liquidaciones de todos los viajes, por el acto que les falta.
 *
 * Calcular, aprobar y pagar son tres actos con tres permisos. Calcular vive en
 * despacho, porque necesita el viaje delante; aprobar y pagar son trabajo de
 * Finanzas y se hacen de una sentada. Cada pestaña ofrece SÓLO el acto que toca:
 * enseñar los dos invitaría a pulsarlos en desorden y a coleccionar 409.
 */

const PESTANAS = [
  { id: 'pendiente', etiqueta: 'Por aprobar' },
  { id: 'aprobada', etiqueta: 'Por pagar' },
  { id: 'pagada', etiqueta: 'Pagadas' },
];

const RESUMEN: Record<string, { uno: string; varios: string; vacio: string }> = {
  pendiente: { uno: 'por aprobar', varios: 'por aprobar', vacio: 'Ninguna liquidación por aprobar.' },
  aprobada: { uno: 'por pagar', varios: 'por pagar', vacio: 'Ninguna liquidación por pagar.' },
  pagada: { uno: 'pagada', varios: 'pagadas', vacio: 'Ninguna liquidación pagada todavía.' },
};

/** Mínimo de `PagarLiquidacionDto.referenciaPago`. */
const REFERENCIA_MINIMA = 3;

const dinero = (v: unknown) =>
  Number(v).toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entero = (v: unknown) => Number(v).toLocaleString('es-PA', { maximumFractionDigits: 0 });

export function Liquidaciones() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pedido = params.get('estado') ?? '';
  // Un estado que no es de los tres no se manda a la API: se abre la primera.
  const estado = PESTANAS.some(p => p.id === pedido) ? pedido : 'pendiente';

  const yo = useUsuarioActual();
  const { filas, error, setError, recargar } =
    useBandeja(`/liquidaciones?estado=${estado}`, 'No se pudieron cargar las liquidaciones');
  const [resultado, setResultado] = useState<string | null>(null);

  const cambiar = (id: string) => {
    const p = new URLSearchParams(params.toString());
    p.set('estado', id);
    setResultado(null);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  async function actuar(fn: () => Promise<unknown>, siSale: string) {
    setError(null); setResultado(null);
    try { await fn(); setResultado(siSale); recargar(); }
    catch (e) { setError(mensajeDeError(e, 'No se pudo completar la acción')); }
  }

  const total = (filas ?? []).reduce((t, l) => t + Number(l.totalPagar), 0);
  const r = RESUMEN[estado];

  return (
    <section className={catalogo.panel}>
      <div className={catalogo.barra}>
        <h1 className={catalogo.titulo}>Liquidaciones</h1>
      </div>

      <div className={catalogo.cuerpo}>
        <Tabs pestanas={PESTANAS} activa={estado} etiquetaGrupo="Liquidaciones" onCambiar={cambiar} />

        {error && <p role="alert" className={catalogo.aviso}>{error}</p>}
        {resultado && <p role="status" className={estilos.resultado}>{resultado}</p>}

        {filas === null ? (
          <>{[0, 1, 2].map(i => <div key={i} className={catalogo.esqueleto} />)}</>
        ) : filas.length === 0 ? (
          !error && <p className={catalogo.vacio}>{r.vacio}</p>
        ) : (
          <>
            <p className={estilos.meta}>
              {filas.length === 1 ? `1 liquidación ${r.uno}` : `${filas.length} liquidaciones ${r.varios}`},
              {' '}por {dinero(total)} en total.
            </p>
            <ul className={estilos.lista}>
              {filas.map(l => (
                <li key={String(l.id)} className={estilos.elemento}>
                  <div className={estilos.cabecera}>
                    <h2 className={estilos.titulo}>{String(l.codigoViaje)} · {String(l.conductor)}</h2>
                    <span className={estilos.estado}>{dinero(l.totalPagar)}</span>
                  </div>
                  <p className={estilos.meta}>
                    {entero(l.kilometros)} km · {String(l.entregasContadas)} entregas · reembolsos {dinero(l.reembolsos)}
                  </p>

                  {estado === 'pendiente' && (puedeDarPorBueno(yo, l.calculadaPor) ? (
                    <div className={estilos.acciones}>
                      <Button onClick={() => void actuar(
                        () => api.crear(`/liquidaciones/${l.id}/aprobar`, {}),
                        `Aprobada la liquidación de ${String(l.codigoViaje)}.`)}>
                        Aprobar<span className="solo-lectores"> la liquidación de {String(l.codigoViaje)}</span>
                      </Button>
                    </div>
                  ) : yo !== null && (
                    <p className={estilos.cierre}>La calculaste tú: tiene que aprobarla otra persona.</p>
                  ))}

                  {estado === 'aprobada' && (
                    <Pagar liquidacion={l} onPagar={referencia => actuar(
                      () => api.crear(`/liquidaciones/${l.id}/pagar`, { referenciaPago: referencia }),
                      `Registrado el pago de ${String(l.codigoViaje)} con la referencia ${referencia}.`)} />
                  )}

                  {estado === 'pagada' && (
                    <p className={estilos.cierre}>
                      Pagada el {String(l.fechaPago).slice(0, 10)} con la referencia {String(l.referenciaPago)}.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function Pagar({ liquidacion, onPagar }: { liquidacion: Fila; onPagar: (referencia: string) => Promise<void> }) {
  const [referencia, setReferencia] = useState('');
  return (
    <div className={estilos.acciones}>
      <span className={estilos.resolver}>
        <Campo etiqueta="Referencia del pago" valor={referencia} onCambio={setReferencia}
               ayuda="La transferencia o el recibo con el que se pagó." />
      </span>
      <Button deshabilitado={referencia.trim().length < REFERENCIA_MINIMA}
              onClick={() => void onPagar(referencia.trim())}>
        Registrar el pago<span className="solo-lectores"> de {String(liquidacion.codigoViaje)}</span>
      </Button>
    </div>
  );
}
