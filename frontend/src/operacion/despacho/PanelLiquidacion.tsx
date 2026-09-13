'use client';

import { useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { api } from '@/api/cliente';
import estilos from './despacho.module.css';
import { miles } from './SeccionCargas';
import { porcentaje } from './SeccionEntregas';
import { BloqueDato } from '@/operacion/BloqueDato';
import type { Fila, Accion } from './tipos';

/**
 * §15.5 · «Liquidación del viaje», el panel dividido que el PRD propone.
 *
 * QUÉ BLOQUES ESTÁN Y CUÁLES NO
 *
 * El §15.5 pide doce: datos generales, kilómetros, consumo, gastos, pago al
 * conductor, volúmenes, mermas, ingreso, costo, utilidad, evidencias y
 * aprobaciones. Están los ocho que hoy tienen dato. Los cuatro que faltan
 * —consumo, ingreso, costo y utilidad— dependen del motor de costos y de
 * `consumo_combustible_vehiculo` (§7.16), que son Fase 3.
 *
 * Se dicen en vez de omitirse. Un panel al que le faltan cuatro bloques sin
 * explicación se lee como un panel terminado que olvidó cosas, y la primera
 * pregunta que provoca —«¿y la utilidad?»— cuesta más de responder que la línea
 * que lo aclara.
 */
export function PanelLiquidacion({ viaje, liquidacion, entregas, cargas, totales, accion }: {
  viaje: Fila; liquidacion: Fila | null; entregas: Fila[]; cargas: Fila[];
  totales: Fila | null; accion: Accion;
}) {
  const [referencia, setReferencia] = useState('');
  const cerrado = viaje.estado === 'cerrado';

  const cargado = suma(cargas, 'volumenCargado');
  const recibido = suma(entregas, 'volumenRecibido');
  const merma = cargado > 0 ? ((cargado - recibido) / cargado) * 100 : 0;
  const fueraDeTolerancia = entregas.filter(e => e.estado === 'pendiente').length;

  return (
    <section className={estilos.seccion} aria-label="Liquidación del viaje">
      <h3 className={estilos.tituloSeccion}>Liquidación del viaje</h3>

      {!cerrado ? (
        /* Regla 12: no se paga una liquidación sin el viaje cerrado. Decirlo
           aquí ahorra el 409, y sobre todo dice QUÉ falta para poder hacerlo. */
        <p className={estilos.vacio}>
          Un viaje se liquida cuando el viaje está cerrado. Éste está «{viaje.estado}».
        </p>
      ) : (
        <>
          <div className={estilos.bloques}>
            <BloqueDato rotulo="Datos generales" dato={String(viaje.codigoViaje)}
                    detalle={String(liquidacion?.conductor ?? viaje.conductor ?? 'sin conductor')} />

            <BloqueDato rotulo="Kilómetros"
                    dato={miles(liquidacion?.kilometros ?? viaje.kilometrosGps ?? 0)}
                    detalle={liquidacion
                      ? `a ${miles(liquidacion.tarifaKmUsada)} por unidad`
                      : 'medidos por GPS (§10.1)'} />

            <BloqueDato rotulo="Volúmenes"
                    dato={`${miles(recibido)} de ${miles(cargado)}`}
                    detalle={`${entregas.length} entrega(s) sobre ${cargas.length} carga(s)`} />

            <BloqueDato rotulo="Mermas" dato={porcentaje(merma)}
                    detalle={fueraDeTolerancia > 0
                      ? `${fueraDeTolerancia} sin resolver todavía`
                      : 'todas dentro de lo aceptado'} />

            <BloqueDato rotulo="Gastos" dato={miles(totales?.totalAprobado ?? 0)}
                    detalle={`sin resolver: ${miles(totales?.totalPendiente ?? 0)}`} />

            <BloqueDato rotulo="Pago al conductor" resaltado
                    dato={liquidacion ? miles(liquidacion.totalPagar) : '—'}
                    detalle={liquidacion
                      ? `entregas ${miles(liquidacion.pagoEntregas)} · reembolsos ${miles(liquidacion.reembolsos)}`
                      : 'todavía sin calcular'} />

            <BloqueDato rotulo="Evidencias"
                    dato={String(entregas.filter(e => e.selloRecibido).length)}
                    detalle="sellos leídos y contrastados con la terminal" />

            <BloqueDato rotulo="Aprobaciones"
                    dato={liquidacion ? String(liquidacion.estado) : 'sin calcular'}
                    detalle={liquidacion?.referenciaPago
                      ? `referencia ${liquidacion.referenciaPago}`
                      : 'calcular, firmar y pagar son tres actos'} />
          </div>

          <p className={estilos.bloqueDetalle}>
            El §15.5 pide además consumo del cabezal, ingreso, costo y utilidad.
            Dependen del motor de costos y de la tabla §7.16, que son Fase 3.
          </p>

          <div className={estilos.acciones} style={{ marginTop: 'var(--esp-4)' }}>
            {/* Los tres actos del §7.18, cada uno con su permiso y su fecha.
                Sólo se ofrece el que toca: enseñar los tres invitaría a
                pulsarlos en desorden y a coleccionar 409. */}
            {!liquidacion && (
              <Button onClick={() => void accion(() =>
                api.crear(`/liquidaciones/viaje/${viaje.id}`, {}))}>
                Calcular liquidación
              </Button>
            )}

            {liquidacion?.estado === 'pendiente' && (
              <Button onClick={() => void accion(() =>
                api.crear(`/liquidaciones/${liquidacion.id}/aprobar`, {}))}>
                Aprobar liquidación
              </Button>
            )}

            {liquidacion?.estado === 'aprobada' && (
              <>
                <Campo etiqueta="Referencia del pago" valor={referencia} onCambio={setReferencia}
                       ayuda="La transferencia o el recibo con el que se pagó." />
                <Button deshabilitado={!referencia.trim()}
                        onClick={() => void accion(() =>
                          api.crear(`/liquidaciones/${liquidacion.id}/pagar`,
                                    { referenciaPago: referencia }))}>
                  Registrar el pago
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

const suma = (filas: Fila[], campo: string) =>
  filas.reduce((t, f) => t + (Number(f[campo]) || 0), 0);
