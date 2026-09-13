'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { api, ErrorApi } from '@/api/cliente';
import { useCargaInicial } from '@/api/carga';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from './despacho.module.css';
import { SeccionCargas } from './SeccionCargas';
import { SeccionEntregas } from './SeccionEntregas';
import { SeccionGastos } from './SeccionGastos';
import { PanelLiquidacion } from './PanelLiquidacion';
import { SeccionBitacora } from './SeccionBitacora';
import { SeccionSolicitudes } from './SeccionSolicitudes';
import type { Fila } from './tipos';

/**
 * Despacho y cierre — la Fase 1C en la interfaz.
 *
 * POR QUÉ UNA PANTALLA Y NO CUATRO
 *
 * Una carga, una entrega, un gasto y una liquidación son SIEMPRE de un viaje.
 * Cuatro pantallas de lista obligarían a elegir el mismo viaje cuatro veces y,
 * peor, permitirían mirar las entregas de un viaje sin ver contra qué carga se
 * concilian — que es justamente la relación que la Fase 1C existe para vigilar.
 *
 * Así que el viaje es la unidad, y las cuatro cosas son momentos suyos. Cuál
 * está abierto lo dice la máquina de estados del §8.2, no una pestaña: el
 * camión no puede descargar antes de cargar, y la pantalla no debería sugerir
 * que sí.
 */
export function Despacho() {
  const [viajes, setViajes] = useState<Fila[] | null>(null);
  const [sel, setSel] = useState<Fila | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cargas, setCargas] = useState<Fila[]>([]);
  const [entregas, setEntregas] = useState<Fila[]>([]);
  const [gastos, setGastos] = useState<Fila[]>([]);
  const [solicitudes, setSolicitudes] = useState<Fila[]>([]);
  const [totales, setTotales] = useState<Fila | null>(null);
  const [liquidacion, setLiquidacion] = useState<Fila | null>(null);
  const [lineas, setLineas] = useState<Fila[]>([]);
  /* §7.15. La integridad va aparte de los eventos y puede ser `null`: que no se
     haya podido comprobar NO es lo mismo que «está rota», y la sección dice
     cada cosa con sus palabras. */
  const [eventos, setEventos] = useState<Fila[]>([]);
  const [integridad, setIntegridad] = useState<Fila | null>(null);

  const cargarLista = useCallback(async () => {
    try { setViajes(await api.listar<Fila>('/viajes')); setError(null); }
    catch (e) {
      setError(mensaje(e, 'No se pudieron cargar los viajes'));
      setViajes([]);
    }
  }, []);
  useCargaInicial(cargarLista);

  /**
   * Trae todo lo que cuelga de un viaje.
   *
   * En paralelo y con `allSettled`: son nueve llamadas independientes y una
   * puede fallar por permisos sin que las otras dejen de tener sentido. Con un
   * `Promise.all` un 403 en gastos —que el Responsable de estación no tiene—
   * dejaría la pantalla entera sin entregas, que sí puede ver. Lo mismo vale
   * para `eventos:leer` y `solicitudesruta:leer`, que también son permisos propios.
   */
  const cargarDetalle = useCallback(async (id: string) => {
    const [viaje, cs, es, gs, tot, liq, evs, integ, sols] = await Promise.allSettled([
      api.obtener<Fila>(`/viajes/${id}`),
      api.listar<Fila>(`/cargas/viaje/${id}`),
      api.listar<Fila>(`/entregas/viaje/${id}`),
      api.listar<Fila>(`/gastos/viaje/${id}`),
      api.obtener<Fila>(`/gastos/viaje/${id}/totales`),
      api.obtener<Fila>(`/liquidaciones/viaje/${id}`),
      api.listar<Fila>(`/eventos/viaje/${id}`),
      api.obtener<Fila>(`/eventos/viaje/${id}/integridad`),
      api.listar<Fila>(`/solicitudes-ruta/viaje/${id}`),
    ]);

    if (viaje.status === 'rejected') {
      setError(mensaje(viaje.reason, 'No se pudo abrir el viaje'));
      return;
    }
    setSel(viaje.value);
    setCargas(cs.status === 'fulfilled' ? cs.value : []);
    setEntregas(es.status === 'fulfilled' ? es.value : []);
    setGastos(gs.status === 'fulfilled' ? gs.value : []);
    setTotales(tot.status === 'fulfilled' ? tot.value : null);
    // Un 404 aquí es lo NORMAL: significa que el viaje todavía no se liquidó.
    // Tratarlo como error llenaría la pantalla de avisos en el caso corriente.
    setLiquidacion(liq.status === 'fulfilled' ? liq.value : null);
    setEventos(evs.status === 'fulfilled' ? evs.value : []);
    /* `null` cuando la verificación no llegó. Poner `{integra:false}` diría que
       la cadena está rota, que es una acusación distinta de «no lo sé». */
    setIntegridad(integ.status === 'fulfilled' ? integ.value : null);
    setSolicitudes(sols.status === 'fulfilled' ? sols.value : []);

    /* Las líneas de las órdenes del viaje traen la TOLERANCIA negociada, que es
       lo que permite avisar de una merma fuera de rango antes de mandarla. No
       viene en el viaje, y calcularla del producto sería otra fuente distinta. */
    const ordenes = await Promise.allSettled(
      (viaje.value.ordenes ?? []).map((o: Fila) => api.obtener<Fila>(`/ordenes/${o.ordenId}`)));
    setLineas(ordenes.flatMap(r =>
      r.status === 'fulfilled' ? ((r.value.detalles ?? []) as Fila[]) : []));
  }, []);

  async function abrir(id: string) {
    setError(null);
    await cargarDetalle(id);
  }

  /** Ejecuta una acción, refresca lo que haya cambiado y cuenta el error. */
  async function accion(fn: () => Promise<unknown>) {
    try {
      await fn();
      setError(null);
      if (sel) await cargarDetalle(String(sel.id));
      await cargarLista();
    } catch (e) {
      setError(mensaje(e, 'No se pudo completar la acción'));
    }
  }

  return (
    <div className={estilos.dos}>
      {/* El aviso va fuera de las dos columnas, igual que en viajes: un 403 al
          cargar la lista deja la pantalla sin nada seleccionado, y dentro del
          panel de detalle no se vería. */}
      {error && (
        <div className={estilos.avisoGeneral} role="alert">
          <p className={catalogo.aviso}>{error}</p>
        </div>
      )}

      <section className={estilos.lista} aria-label="Viajes en despacho">
        <div className={catalogo.barra}>
          <h1 className={catalogo.titulo}>Despacho y cierre</h1>
        </div>
        <div className={estilos.listaCuerpo}>
          {viajes === null ? (
            <>{[0, 1, 2].map(i => <div key={i} className={catalogo.esqueleto} />)}</>
          ) : viajes.length === 0 ? (
            <p className={estilos.vacio}>No hay viajes en despacho todavía.</p>
          ) : viajes.map(v => (
            <button key={String(v.id)} type="button"
                    className={`${estilos.tarjeta} ${sel?.id === v.id ? estilos.activa : ''}`}
                    aria-pressed={sel?.id === v.id}
                    onClick={() => void abrir(String(v.id))}>
              <div className={estilos.codigo}>{v.codigoViaje}</div>
              <div className={estilos.meta}>
                {String(v.fechaProgramada ?? '').slice(0, 10)} · {v.conductor ?? 'sin conductor'}
              </div>
              <span className={estilos.pastilla}>{v.estado}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={estilos.detalle} aria-label="Despacho del viaje">
        {!sel ? (
          <p className={catalogo.vacio} style={{ padding: 'var(--esp-8)' }}>
            Selecciona un viaje para registrar su carga, sus entregas y su cierre.
          </p>
        ) : (
          <>
            <div className={catalogo.barra}>
              <h2 className={catalogo.titulo}>{sel.codigoViaje}</h2>
              <span className={estilos.pastilla}>{sel.estado}</span>

              {/* Las transiciones del §8.2 viven TAMBIÉN aquí, y no sólo en la
                  pantalla de viajes. No es duplicar el control —la lista de
                  transiciones posibles la manda la API, que sigue siendo la
                  única autoridad— sino ponerlo donde se usa: esta pantalla
                  acompaña al camión desde la terminal hasta el pago, y obligar a
                  saltar a otra para pulsar «cargado» y volver convierte un
                  recorrido en una pelea con el menú. */}
              <div className={estilos.acciones}>
                {(sel.transicionesPosibles ?? []).map((e: string) => (
                  <Button key={e} variante="secundario"
                          onClick={() => void accion(async () => {
                            const motivo = e === 'cancelado'
                              ? window.prompt('Motivo de la cancelación:') : null;
                            if (e === 'cancelado' && !motivo) return;
                            await api.actualizar(`/viajes/${sel.id}/estado`,
                              { estado: e, ...(motivo ? { motivo } : {}) });
                          })}>
                    {e}
                  </Button>
                ))}
              </div>
            </div>

            <SeccionCargas viaje={sel} cargas={cargas} accion={accion} />
            <SeccionEntregas viaje={sel} cargas={cargas} entregas={entregas}
                             lineas={lineas} accion={accion} />
            <SeccionGastos viaje={sel} gastos={gastos} totales={totales} accion={accion} />
            <PanelLiquidacion viaje={sel} liquidacion={liquidacion} entregas={entregas}
                              cargas={cargas} totales={totales} accion={accion} />
            {/* Al final: es lo que se consulta cuando algo no cuadra, no lo que
                se rellena al despachar. */}
            <SeccionSolicitudes solicitudes={solicitudes} />
            <SeccionBitacora viaje={sel} eventos={eventos} integridad={integridad}
                             accion={accion} />
          </>
        )}
      </section>
    </div>
  );
}

const mensaje = (e: unknown, porOmision: string) =>
  e instanceof ErrorApi ? e.message : porOmision;
