'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { api, ErrorApi } from '@/api/cliente';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from './viajes.module.css';

type Fila = Record<string, any>;

export default function Viajes() {
  const [viajes, setViajes] = useState<Fila[] | null>(null);
  const [sel, setSel] = useState<Fila | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Catálogos para los desplegables
  const [cisternas, setCisternas] = useState<Fila[]>([]);
  const [conductores, setConductores] = useState<Fila[]>([]);
  const [ordenes, setOrdenes] = useState<Fila[]>([]);
  const [compartimentos, setCompartimentos] = useState<Fila[]>([]);

  // Alta de viaje
  const [codigo, setCodigo] = useState('');
  const [fechaProgramada, setFechaProgramada] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [cisternaId, setCisternaId] = useState('');
  const [conductorId, setConductorId] = useState('');

  // Alta de línea de plan de carga
  const [compId, setCompId] = useState('');
  const [detalleId, setDetalleId] = useState('');
  const [volumen, setVolumen] = useState('');

  const cargar = useCallback(async () => {
    try { setViajes(await api.listar<Fila>('/viajes')); setError(null); }
    catch (e) { setError(e instanceof ErrorApi ? e.message : 'No se pudo cargar'); setViajes([]); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    void api.listar<Fila>('/cisternas').then(setCisternas).catch(() => undefined);
    void api.listar<Fila>('/conductores').then(setConductores).catch(() => undefined);
    void api.listar<Fila>('/ordenes?estado=validada').then(setOrdenes).catch(() => undefined);
  }, []);

  /* Los compartimentos son los de LA cisterna del viaje seleccionado: la API
     rechaza cualquier otro, así que ofrecerlos sería ofrecer un error. */
  useEffect(() => {
    if (!sel?.cisternaId) { setCompartimentos([]); return; }
    void api.listar<Fila>(`/cisternas/${sel.cisternaId}/compartimentos`)
      .then(setCompartimentos).catch(() => undefined);
  }, [sel?.cisternaId]);

  async function abrir(id: string) {
    try { setSel(await api.obtener<Fila>(`/viajes/${id}`)); setError(null); }
    catch (e) { setError(e instanceof ErrorApi ? e.message : 'No se pudo abrir el viaje'); }
  }

  async function accion(fn: () => Promise<unknown>) {
    try {
      await fn();
      if (sel) await abrir(String(sel.id));
      await cargar();
      setError(null);
    } catch (e) { setError(e instanceof ErrorApi ? e.message : 'No se pudo completar la acción'); }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(null);
    try {
      const v = await api.crear<Fila>('/viajes', {
        codigoViaje: codigo,
        fechaProgramada: new Date(fechaProgramada).toISOString(),
        ...(fechaFin ? { fechaFin: new Date(fechaFin).toISOString() } : {}),
        ...(cisternaId ? { cisternaId } : {}),
        ...(conductorId ? { conductorId } : {}),
      });
      setAbierto(false);
      setCodigo(''); setFechaProgramada(''); setFechaFin(''); setCisternaId(''); setConductorId('');
      await cargar();
      await abrir(String(v.id));
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo crear el viaje');
    } finally { setGuardando(false); }
  }

  /* Las líneas de las órdenes ya asignadas al viaje: son las únicas a las que
     se puede asignar carga. */
  const [lineasDisponibles, setLineasDisponibles] = useState<Fila[]>([]);
  useEffect(() => {
    if (!sel?.ordenes?.length) { setLineasDisponibles([]); return; }
    Promise.all(sel.ordenes.map((o: Fila) => api.obtener<Fila>(`/ordenes/${o.ordenId}`)))
      .then(os => setLineasDisponibles(os.flatMap((o: Fila) =>
        (o.detalles ?? []).map((d: Fila) => ({ ...d, orden: o.numeroOrdenExterna ?? `#${o.id}` })))))
      .catch(() => setLineasDisponibles([]));
  }, [sel]);

  return (
    <div className={estilos.dos}>
      {/* El aviso va FUERA de las dos columnas a propósito. Estuvo dentro del
          panel de detalle, y ahí sólo se veía con un viaje seleccionado: un 403
          al cargar la lista, o un fallo al crear el PRIMER viaje, dejaban la
          pantalla vacía y muda. Los dos son justo los primeros errores que se
          encuentra alguien que estrena el sistema. */}
      {error && (
        <div className={estilos.avisoGeneral} role="alert">
          <p className={catalogo.aviso}>{error}</p>
        </div>
      )}
      <section className={estilos.lista} aria-label="Viajes">
        <div className={catalogo.barra}>
          <h1 className={catalogo.titulo}>Viajes</h1>
          <Button icono="mas" onClick={() => setAbierto(a => !a)}>Nuevo</Button>
        </div>
        <div className={estilos.listaCuerpo}>
          {abierto && (
            <form className={catalogo.formulario} onSubmit={crear} style={{ gridTemplateColumns: '1fr' }}>
              <Campo etiqueta="Código del viaje" requerido valor={codigo} onCambio={setCodigo} />
              <Campo etiqueta="Programado para" requerido valor={fechaProgramada}
                     onCambio={setFechaProgramada} tipo="date"
                     ayuda="La ocupación de cisterna y conductor se calcula desde aquí." />
              <Campo etiqueta="Fin previsto" tipo="date" valor={fechaFin} onCambio={setFechaFin}
                     ayuda="Sin fin, el viaje ocupa hacia adelante sin límite." />
              <Campo etiqueta="Cisterna" valor={cisternaId} onCambio={setCisternaId}
                     opciones={cisternas.map(c => ({ valor: String(c.id), etiqueta: String(c.placa) }))} />
              <Campo etiqueta="Conductor" valor={conductorId} onCambio={setConductorId}
                     opciones={conductores.map(c => ({ valor: String(c.id), etiqueta: String(c.nombreCompleto) }))} />
              <div className={catalogo.pieFormulario}>
                <Button variante="secundario" onClick={() => setAbierto(false)}>Cancelar</Button>
                <Button tipo="submit" cargando={guardando}>Crear</Button>
              </div>
            </form>
          )}

          {viajes === null ? (
            <>{[0, 1, 2].map(i => <div key={i} className={catalogo.esqueleto} />)}</>
          ) : viajes.length === 0 ? (
            <p className={estilos.vacio}>Todavía no hay viajes.</p>
          ) : viajes.map(v => (
            <button key={String(v.id)} type="button"
                    className={`${estilos.tarjeta} ${sel?.id === v.id ? estilos.activa : ''}`}
                    aria-pressed={sel?.id === v.id}
                    onClick={() => void abrir(String(v.id))}>
              <div className={estilos.codigo}>{v.codigoViaje}</div>
              <div className={estilos.meta}>
                {String(v.fechaProgramada).slice(0, 10)} · {v.conductor ?? 'sin conductor'}
              </div>
              <span className={estilos.pastilla}>{v.estado}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={estilos.detalle} aria-label="Detalle del viaje">
        {!sel ? (
          <p className={catalogo.vacio} style={{ padding: 'var(--esp-8)' }}>
            Selecciona un viaje para ver su plan de carga.
          </p>
        ) : (
          <>
            <div className={catalogo.barra}>
              <h2 className={catalogo.titulo}>{sel.codigoViaje}</h2>
              <div className={estilos.acciones}>
                {/* Autorizar es una acción propia con su propio permiso: quien
                    planifica no autoriza. Si el rol no lo tiene, la API
                    responde 403 y el mensaje aparece abajo. */}
                {sel.estado === 'programado' && (
                  <Button onClick={() => void accion(() => api.crear(`/viajes/${sel.id}/autorizar`, {}))}>
                    Autorizar
                  </Button>
                )}
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

            <div className={estilos.seccion}>
              <h3 className={estilos.tituloSeccion}>Órdenes del viaje</h3>
              {sel.ordenes?.length === 0 ? (
                <p className={estilos.vacio}>Ninguna orden asignada.</p>
              ) : (
                <table className={estilos.tablaMini}>
                  <thead><tr><th>Sec.</th><th>Orden</th><th>Estación</th><th>Estado</th></tr></thead>
                  <tbody>
                    {sel.ordenes?.map((o: Fila) => (
                      <tr key={String(o.id)}>
                        <td className={estilos.num}>{o.secuencia}</td>
                        <td>#{o.ordenId}</td><td>{o.estacion}</td><td>{o.estado}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {['borrador', 'programado'].includes(sel.estado) && ordenes.length > 0 && (
                <AsignarOrden ordenes={ordenes} yaAsignadas={(sel.ordenes ?? []).map((o: Fila) => String(o.ordenId))}
                  onAsignar={(ordenId, secuencia) =>
                    void accion(() => api.crear(`/viajes/${sel.id}/ordenes`,
                      { ordenId, secuenciaEntrega: secuencia }))} />
              )}

              <h3 className={estilos.tituloSeccion}>Plan de carga</h3>
              {sel.planCarga?.length === 0 ? (
                <p className={estilos.vacio}>Sin plan de carga. El viaje no puede autorizarse así.</p>
              ) : (
                <table className={estilos.tablaMini}>
                  <thead><tr><th>Comp.</th><th>Producto</th><th>Volumen</th><th>Calibrado</th><th /></tr></thead>
                  <tbody>
                    {sel.planCarga?.map((l: Fila) => (
                      <tr key={String(l.id)}>
                        <td className={estilos.num}>{l.compartimento}</td>
                        <td>{l.producto}</td>
                        <td className={estilos.num}>{Number(l.volumenPlanificado).toLocaleString('es-PA')}</td>
                        <td className={estilos.num}>{Number(l.capacidadCalibrada).toLocaleString('es-PA')}</td>
                        <td>
                          {['borrador', 'programado'].includes(sel.estado) && (
                            <Button variante="secundario"
                                    onClick={() => void accion(() =>
                                      api.desactivar(`/viajes/${sel.id}/plan-carga/${l.id}`))}>
                              Quitar<span className="solo-lectores"> compartimento {l.compartimento}</span>
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {['borrador', 'programado'].includes(sel.estado) && (
                <div className={estilos.formLinea}>
                  <Campo etiqueta="Compartimento" valor={compId} onCambio={setCompId}
                         opciones={compartimentos.map(c => ({
                           valor: String(c.id),
                           etiqueta: `N.º ${c.numero} · calibrado ${c.capacidadCalibrada}`,
                         }))} />
                  <Campo etiqueta="Línea de orden" valor={detalleId} onCambio={setDetalleId}
                         opciones={lineasDisponibles.map(d => ({
                           valor: String(d.id),
                           etiqueta: `${d.orden} · ${d.producto} · quedan ${d.volumenPendiente}`,
                         }))} />
                  <Campo etiqueta="Volumen" tipo="number" valor={volumen} onCambio={setVolumen} />
                  <Button deshabilitado={!compId || !detalleId || !volumen}
                          onClick={() => void accion(async () => {
                            await api.crear(`/viajes/${sel.id}/plan-carga`, {
                              compartimentoId: compId, detalleOrdenId: detalleId,
                              volumenPlanificado: Number(volumen),
                            });
                            setCompId(''); setDetalleId(''); setVolumen('');
                          })}>
                    Asignar carga
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function AsignarOrden({ ordenes, yaAsignadas, onAsignar }: {
  ordenes: Fila[]; yaAsignadas: string[]; onAsignar: (ordenId: string, secuencia: number) => void;
}) {
  const [ordenId, setOrdenId] = useState('');
  const [secuencia, setSecuencia] = useState('1');
  const disponibles = ordenes.filter(o => !yaAsignadas.includes(String(o.id)));
  if (disponibles.length === 0) return null;

  return (
    <div className={estilos.formLinea}>
      <Campo etiqueta="Orden validada" valor={ordenId} onCambio={setOrdenId}
             opciones={disponibles.map(o => ({
               valor: String(o.id),
               etiqueta: `${o.numeroOrdenExterna ?? '#' + o.id} · ${o.estacion}`,
             }))} />
      <Campo etiqueta="Secuencia" tipo="number" valor={secuencia} onCambio={setSecuencia} />
      <Button deshabilitado={!ordenId} onClick={() => onAsignar(ordenId, Number(secuencia))}>
        Asignar orden
      </Button>
    </div>
  );
}
