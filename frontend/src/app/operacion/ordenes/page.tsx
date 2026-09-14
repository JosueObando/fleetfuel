'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { StatusBadge, type EstadoEnvio } from '@/componentes/StatusBadge/StatusBadge';
import { api, ErrorApi } from '@/api/cliente';
import { useCargaInicial } from '@/api/carga';
import type { Fila } from '@/api/tipos';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from './ordenes.module.css';
import { EditarOrden } from './EditarOrden';

interface Linea { productoId: string; volumenSolicitado: string; tolerancia: string }

const LINEA_VACIA: Linea = { productoId: '', volumenSolicitado: '', tolerancia: '' };

/* La insignia de estado ya existe para envíos; se reutiliza mapeando los
   estados de orden a sus cuatro colores en vez de inventar otra escala. */
const COLOR: Record<string, EstadoEnvio> = {
  recibida: 'esperando', validada: 'esperando', planificada: 'esperando', asignada: 'esperando',
  en_carga: 'enRuta', cargada: 'enRuta', en_transito: 'enRuta', entrega_parcial: 'enRuta',
  entregada: 'entregado', conciliada: 'entregado', cerrada: 'entregado',
  rechazada: 'retrasado', cancelada: 'retrasado', suspendida: 'retrasado', con_incidencia: 'retrasado',
};

const EXIGEN_MOTIVO = new Set(['rechazada', 'cancelada', 'suspendida', 'con_incidencia']);

export default function Ordenes() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [clientes, setClientes] = useState<Fila[]>([]);
  /* TODAS las estaciones, sin filtrar. El filtro por cliente es una DERIVADA
     —`estacionesDelCliente`, más abajo— y no un estado: guardarlo filtrado
     obligaba a vaciarlo con un `setState` síncrono dentro de un efecto cada
     vez que se cambiaba de cliente, que es un render de más y lo que React 19
     señala como `set-state-in-effect`. */
  const [estaciones, setEstaciones] = useState<Fila[]>([]);
  const [productos, setProductos] = useState<Fila[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<Fila | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [clienteId, setClienteId] = useState('');
  const [estacionId, setEstacionId] = useState('');
  const [externa, setExterna] = useState('');
  const [fechaRequerida, setFechaRequerida] = useState('');
  const [prioridad, setPrioridad] = useState('normal');
  const [lineas, setLineas] = useState<Linea[]>([LINEA_VACIA]);

  const cargar = useCallback(async () => {
    try { setFilas(await api.listar<Fila>('/ordenes')); setError(null); }
    catch (e) { setError(e instanceof ErrorApi ? e.message : 'No se pudo cargar'); setFilas([]); }
  }, []);
  useCargaInicial(cargar);

  useEffect(() => {
    if (!abierto) return;
    void api.listar<Fila>('/clientes').then(setClientes).catch(() => undefined);
    void api.listar<Fila>('/productos').then(setProductos).catch(() => undefined);
    void api.listar<Fila>('/estaciones').then(setEstaciones).catch(() => undefined);
  }, [abierto]);

  /* Las estaciones se filtran por cliente: la API exige que la estación sea
     del cliente de la orden, así que ofrecer las demás sería ofrecer un error.

     El filtro se calcula al pintar y el reinicio de la estación elegida vive en
     el manejador del cambio de cliente, no en un efecto: cambiar de cliente es
     un EVENTO, y ajustar estado en respuesta a un evento es donde React dice
     que hay que hacerlo. */
  const estacionesDelCliente = clienteId
    ? estaciones.filter(e => String(e.clienteId) === clienteId)
    : [];

  function elegirCliente(id: string) {
    setClienteId(id);
    // La estación elegida era de OTRO cliente: dejarla puesta mandaría a la API
    // una pareja que rechaza.
    setEstacionId('');
  }

  function tocar(i: number, campo: keyof Linea, v: string) {
    setLineas(ls => ls.map((l, j) => (j === i ? { ...l, [campo]: v } : l)));
  }

  const total = lineas.reduce((t, l) => t + (Number(l.volumenSolicitado) || 0), 0);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(null);
    try {
      await api.crear('/ordenes', {
        clienteId, estacionId,
        ...(externa ? { numeroOrdenExterna: externa } : {}),
        ...(fechaRequerida ? { fechaRequerida } : {}),
        prioridad,
        detalles: lineas.map(l => ({
          productoId: l.productoId,
          volumenSolicitado: Number(l.volumenSolicitado),
          ...(l.tolerancia ? { tolerancia: Number(l.tolerancia) } : {}),
        })),
      });
      setAbierto(false);
      setClienteId(''); setEstacionId(''); setExterna('');
      setFechaRequerida(''); setPrioridad('normal'); setLineas([LINEA_VACIA]);
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo guardar');
    } finally { setGuardando(false); }
  }

  /* Sobre la orden LEÍDA AL ABRIR: la fila puede llevar rato pintada, y si
     otra persona la planificó entretanto, el formulario ni debería abrirse. */
  async function editar(fila: Fila) {
    setError(null);
    try {
      const orden = await api.obtener<Fila>(`/ordenes/${fila.id}`);
      setAbierto(false);
      setEditando(orden);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo abrir la orden');
    }
  }

  async function transicionar(fila: Fila, estado: string) {
    let motivo: string | null = null;
    if (EXIGEN_MOTIVO.has(estado)) {
      motivo = window.prompt(`Motivo para pasar la orden a «${estado}»:`);
      if (!motivo) return;   // cancelar el prompt cancela la acción
    }
    try {
      await api.actualizar(`/ordenes/${fila.id}/estado`, { estado, ...(motivo ? { motivo } : {}) });
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo cambiar el estado');
    }
  }

  return (
    <section className={catalogo.panel}>
      <div className={catalogo.barra}>
        <h1 className={catalogo.titulo}>Órdenes</h1>
        <Button icono="mas" onClick={() => { setEditando(null); setAbierto(a => !a); }}>Nueva orden</Button>
      </div>

      <div className={catalogo.cuerpo}>
        {abierto && (
          <form className={catalogo.formulario} onSubmit={guardar}>
            <Campo etiqueta="Cliente" requerido valor={clienteId} onCambio={elegirCliente}
                   opciones={clientes.map(c => ({ valor: String(c.id), etiqueta: String(c.nombre) }))} />
            <Campo etiqueta="Estación" requerido valor={estacionId} onCambio={setEstacionId}
                   ayuda={clienteId ? undefined : 'Elige primero el cliente.'}
                   opciones={estacionesDelCliente.map(e => ({ valor: String(e.id), etiqueta: String(e.nombre) }))} />
            <Campo etiqueta="N.º de orden externa" valor={externa} onCambio={setExterna} />
            <Campo etiqueta="Fecha requerida" tipo="date" valor={fechaRequerida} onCambio={setFechaRequerida} />
            <Campo etiqueta="Prioridad" valor={prioridad} onCambio={setPrioridad}
                   opciones={['baja', 'normal', 'alta', 'urgente'].map(p => ({ valor: p, etiqueta: p }))} />

            <div className={estilos.lineas}>
              <div className={estilos.cabeceraLineas}>
                <span className={estilos.tituloLineas}>Productos</span>
                <span className={estilos.total} aria-live="polite">
                  Total: {total.toLocaleString('es-PA')}
                </span>
              </div>
              <ul className={estilos.lista}>
                {lineas.map((l, i) => (
                  <li key={i} className={estilos.filaLinea}>
                    <Campo etiqueta="Producto" requerido valor={l.productoId}
                           onCambio={v => tocar(i, 'productoId', v)}
                           opciones={productos.map(p => ({ valor: String(p.id), etiqueta: String(p.nombre) }))} />
                    <Campo etiqueta="Volumen" tipo="number" requerido valor={l.volumenSolicitado}
                           onCambio={v => tocar(i, 'volumenSolicitado', v)} />
                    <Campo etiqueta="Tolerancia %" tipo="number" valor={l.tolerancia}
                           onCambio={v => tocar(i, 'tolerancia', v)} />
                    <Button variante="secundario" deshabilitado={lineas.length === 1}
                            onClick={() => setLineas(ls => ls.filter((_, j) => j !== i))}>
                      Quitar<span className="solo-lectores"> línea {i + 1}</span>
                    </Button>
                  </li>
                ))}
              </ul>
              <Button variante="secundario" icono="mas"
                      onClick={() => setLineas(ls => [...ls, { ...LINEA_VACIA }])}>
                Añadir producto
              </Button>
            </div>

            {error && <p className={catalogo.aviso}>{error}</p>}
            <div className={catalogo.pieFormulario}>
              <Button variante="secundario" onClick={() => setAbierto(false)}>Cancelar</Button>
              <Button tipo="submit" cargando={guardando}>Crear orden</Button>
            </div>
          </form>
        )}

        {editando && (
          <EditarOrden key={String(editando.id)} orden={editando}
                       onCancelar={() => setEditando(null)}
                       onGuardada={() => { setEditando(null); void cargar(); }} />
        )}

        {!abierto && error && <p className={catalogo.aviso}>{error}</p>}

        {filas === null ? (
          <>{[0, 1, 2].map(i => <div key={i} className={catalogo.esqueleto} />)}</>
        ) : filas.length === 0 ? (
          <p className={catalogo.vacio}>Todavía no hay órdenes.</p>
        ) : (
          <table className={catalogo.tabla}>
            <thead>
              <tr>
                <th scope="col">Orden</th><th scope="col">Cliente</th><th scope="col">Estación</th>
                <th scope="col">Requerida</th><th scope="col">Volumen</th>
                <th scope="col">Estado</th><th scope="col">Siguiente paso</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={String(f.id)}>
                  <td>{f.numeroOrdenExterna ?? `#${f.id}`}</td>
                  <td>{f.cliente}</td>
                  <td>{f.estacion}</td>
                  <td>{f.fechaRequerida ? String(f.fechaRequerida).slice(0, 10) : '—'}</td>
                  <td className={catalogo.numerico}>{Number(f.volumenTotal).toLocaleString('es-PA')}</td>
                  <td><StatusBadge estado={COLOR[f.estado] ?? 'esperando'} />
                      <span className={estilos.estadoTexto}>{f.estado}</span></td>
                  <td>
                    {/* Las transiciones vienen en la propia lista: la interfaz
                        no replica la máquina de estados, la muestra. */}
                    <div className={estilos.transiciones}>
                      {f.admiteEdicion && (
                        <Button variante="secundario" onClick={() => void editar(f)}>
                          Editar<span className="solo-lectores"> {String(f.numeroOrdenExterna ?? `#${f.id}`)}</span>
                        </Button>
                      )}
                      {(f.transicionesPosibles ?? []).length === 0
                        ? <span className={estilos.estadoTexto}>final</span>
                        : (f.transicionesPosibles as string[]).slice(0, 3).map(e => (
                            <Button key={e} variante="secundario"
                                    onClick={() => void transicionar(f, e)}>{e}</Button>
                          ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
