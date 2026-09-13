'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Campo } from '@/componentes/Campo/Campo';
import { Tabs } from '@/componentes/Tabs/Tabs';
import { SegmentedControl } from '@/componentes/SegmentedControl/SegmentedControl';
import { api, ErrorApi } from '@/api/cliente';
import type { Fila } from '@/api/tipos';
import { BloqueDato } from '@/operacion/BloqueDato';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from './informes.module.css';

/**
 * §14 · Los informes de la Fase 1C, que existían en la API y no en la pantalla.
 *
 * EL ESTADO VIVE EN LA URL
 *
 * Mismo criterio que el tablero: un informe filtrado —las mermas por cisterna
 * de un rango de fechas— es algo que se manda por mensaje. Sin URL habría que
 * explicar por dónde llegar, y lo que se explica se explica mal.
 *
 * LO QUE ESTA PANTALLA AÑADE SOBRE LA API
 *
 * Las RESTAS. La API devuelve sumas honestas; el informe del §14.2 existe para
 * hacer visible el descuadre que el §7 llama el riesgo principal de este
 * negocio, y cuatro números en fila dejan esa resta a cargo de quien mira. Aquí
 * se hace y se nombra: cuánto no llegó, y si la cadena cuadra o no.
 *
 * Los del §14.3 (costo por kilómetro, rentabilidad) no están porque no existen
 * en la API: dependen del motor de costos de la Fase 3.
 */

const INFORMES = [
  { id: 'operativo',   etiqueta: 'Operativo' },
  { id: 'volumen',     etiqueta: 'Volumen' },
  { id: 'mermas',      etiqueta: 'Mermas' },
  { id: 'recorridos',  etiqueta: 'Recorridos' },
];

const AGRUPACIONES = [
  { id: 'conductor', etiqueta: 'Por conductor' },
  { id: 'cisterna',  etiqueta: 'Por cisterna' },
  { id: 'producto',  etiqueta: 'Por producto' },
];

export function Informes() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const informe = params.get('informe') ?? 'operativo';
  const fecha = params.get('fecha') ?? '';
  const desde = params.get('desde') ?? '';
  const hasta = params.get('hasta') ?? '';
  const agruparPor = params.get('agruparPor') ?? 'conductor';

  /* Lo cargado va CON la consulta a la que corresponde, y «cargando» se deriva
     comparándola. Antes esto era un `setDatos(null)` al principio del efecto
     para enseñar los esqueletos: un `setState` síncrono dentro de un efecto —el
     render de más que React 19 señala— y, de paso, la misma clase de fallo que
     ya apareció en la pantalla de viajes: la respuesta de un informe que llega
     tarde pintaría sus números bajo el título de otro. Derivar cierra las dos
     por construcción. */
  const [cargado, setCargado] =
    useState<{ consulta: string; datos: Fila | Fila[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const consultaActual = `${informe}|${fecha}|${desde}|${hasta}|${agruparPor}`;
  const datos = cargado?.consulta === consultaActual ? cargado.datos : null;

  const fijar = useCallback((clave: string, valor: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (!valor) p.delete(clave); else p.set(clave, valor);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  /* Cada informe tiene su ruta y su forma —dos devuelven un objeto y dos una
     lista—, así que la petición se arma aquí y no en cada bloque: un `useEffect`
     por informe repetiría cuatro veces el manejo del error. */
  useEffect(() => {
    let vigente = true;
    const consulta = (pares: Array<[string, string]>) => {
      const p = new URLSearchParams(pares.filter(([, v]) => v));
      return p.toString() ? `?${p.toString()}` : '';
    };

    const pedir = async (): Promise<Fila | Fila[]> => {
      if (informe === 'operativo') {
        return api.obtener<Fila>(`/informes/operativo${consulta([['fecha', fecha]])}`);
      }
      if (informe === 'volumen') {
        return api.obtener<Fila>(
          `/informes/volumen${consulta([['desde', desde], ['hasta', hasta]])}`);
      }
      if (informe === 'mermas') {
        return api.listar<Fila>(`/informes/mermas?agruparPor=${agruparPor}`);
      }
      return api.listar<Fila>('/informes/recorridos?limite=100');
    };

    pedir()
      .then(d => { if (vigente) { setCargado({ consulta: consultaActual, datos: d }); setError(null); } })
      .catch(e => {
        if (!vigente) return;
        setError(e instanceof ErrorApi ? e.message : 'No se pudo cargar el informe');
        const vacio = informe === 'mermas' || informe === 'recorridos' ? [] : {};
        setCargado({ consulta: consultaActual, datos: vacio });
      });
    return () => { vigente = false; };
  }, [consultaActual, informe, fecha, desde, hasta, agruparPor]);

  return (
    <div className={estilos.pantalla}>
      <div className={catalogo.barra}>
        <h1 className={catalogo.titulo}>Informes</h1>
      </div>

      <Tabs pestanas={INFORMES} activa={informe} etiquetaGrupo="Informes"
            onCambiar={id => fijar('informe', id)} />

      {error && (
        <div role="alert" className={estilos.aviso}>
          <p className={catalogo.aviso}>{error}</p>
        </div>
      )}

      <div className={estilos.filtros}>
        {informe === 'operativo' && (
          <Campo etiqueta="Día" tipo="date" valor={fecha} onCambio={v => fijar('fecha', v)}
                 ayuda="Sin fecha, el día de hoy." />
        )}
        {informe === 'volumen' && (
          <>
            <Campo etiqueta="Desde" tipo="date" valor={desde} onCambio={v => fijar('desde', v)} />
            <Campo etiqueta="Hasta" tipo="date" valor={hasta} onCambio={v => fijar('hasta', v)} />
          </>
        )}
        {informe === 'mermas' && (
          <SegmentedControl opciones={AGRUPACIONES} seleccionada={agruparPor}
                            etiquetaGrupo="Agrupar las mermas"
                            onSeleccionar={id => fijar('agruparPor', id)} />
        )}
      </div>

      {datos === null ? (
        <div className={estilos.bloques}>
          {[0, 1, 2, 3].map(i => <div key={i} className={catalogo.esqueleto} />)}
        </div>
      ) : informe === 'operativo' ? <Operativo d={datos as Fila} />
        : informe === 'volumen' ? <Volumen d={datos as Fila} />
        : informe === 'mermas' ? <Mermas filas={datos as Fila[]} agruparPor={agruparPor} />
        : <Recorridos filas={datos as Fila[]} />}
    </div>
  );
}

/** §14.1 · La foto operativa del día. */
function Operativo({ d }: { d: Fila }) {
  const retrasados = Number(d.viajesRetrasados ?? 0);
  return (
    <div className={estilos.bloques}>
      <BloqueDato rotulo="Viajes programados" dato={entero(d.viajesProgramados)}
                  detalle="para el día elegido" />
      <BloqueDato rotulo="Cisternas en ruta" dato={entero(d.cisternasEnRuta)}
                  detalle="fuera del patio ahora mismo" />
      <BloqueDato rotulo="Cisternas disponibles" dato={entero(d.cisternasDisponibles)}
                  detalle="sin viaje abierto" />
      <BloqueDato rotulo="Órdenes pendientes" dato={entero(d.ordenesPendientes)}
                  detalle="recibidas, validadas o planificadas" />
      <BloqueDato rotulo="Órdenes entregadas" dato={entero(d.ordenesEntregadas)}
                  detalle="entregadas, conciliadas o cerradas" />
      <BloqueDato rotulo="Entregas parciales" dato={entero(d.entregasParciales)}
                  detalle="con volumen todavía pendiente" />
      {/* El retraso no puede verse igual que los demás: el informe existe para
          que salte, no para que haya que buscarlo entre siete casillas. */}
      <BloqueDato rotulo="Viajes retrasados" dato={entero(retrasados)} resaltado={retrasados > 0}
                  detalle={retrasados > 0
                    ? `${retrasados} requieren atención: debieron salir y no han salido`
                    : 'ninguno fuera de hora'} />
    </div>
  );
}

/**
 * §14.2 · La cadena del volumen: solicitado → planificado → entregado.
 *
 * Los tres números salen de sitios distintos —la orden, el plan de carga y las
 * entregas— y que no cuadren ES la señal. Así que además de los eslabones se
 * enseñan los dos huecos: lo que no se llegó a planificar y lo que no llegó a
 * entregarse de lo planificado.
 */
function Volumen({ d }: { d: Fila }) {
  const solicitado = Number(d.volumenSolicitado ?? 0);
  const planificado = Number(d.volumenPlanificado ?? 0);
  const entregado = Number(d.volumenEntregado ?? 0);
  const pendiente = Number(d.volumenPendiente ?? 0);

  const sinPlanificar = solicitado - planificado;
  const sinEntregar = planificado - entregado;
  const cuadra = sinPlanificar === 0 && sinEntregar === 0;

  return (
    <>
      <div className={estilos.bloques}>
        <BloqueDato rotulo="Solicitado" dato={miles(solicitado)} detalle="lo que pidieron las órdenes" />
        <BloqueDato rotulo="Planificado" dato={miles(planificado)} detalle="lo repartido en compartimentos" />
        <BloqueDato rotulo="Entregado" dato={miles(entregado)} detalle="lo que las estaciones aceptaron" />
        <BloqueDato rotulo="Pendiente" dato={miles(pendiente)} detalle="lo que las órdenes siguen debiendo" />
      </div>

      <div className={estilos.bloques}>
        <BloqueDato rotulo="Sin planificar" dato={miles(sinPlanificar)}
                    resaltado={sinPlanificar !== 0}
                    detalle="pedido y todavía sin repartir en ninguna cisterna" />
        <BloqueDato rotulo="Sin entregar" dato={miles(sinEntregar)}
                    resaltado={sinEntregar !== 0}
                    detalle="salió en el plan y no consta como recibido" />
      </div>

      <p className={estilos.veredicto}>
        {cuadra
          ? 'Todo lo pedido se planificó y todo lo planificado consta entregado: la cadena cuadra.'
          : 'La cadena no cuadra. Cada hueco tiene una explicación posible —una orden a medio '
            + 'planificar, una entrega sin registrar, una merma— y todas dejan rastro en el '
            + 'informe de mermas y en la auditoría.'}
      </p>
    </>
  );
}

/** §14.2 · Mermas agrupadas. La API las devuelve por descuadre descendente. */
function Mermas({ filas, agruparPor }: { filas: Fila[]; agruparPor: string }) {
  if (filas.length === 0) {
    return <p className={estilos.vacio}>Todavía no hay entregas de las que calcular mermas.</p>;
  }
  return (
    <table className={estilos.tabla}>
      <caption className={estilos.leyenda}>
        Ordenadas por descuadre, de mayor a menor. La merma media va ponderada por volumen:
        promediar porcentajes esconde un descuadre grande detrás de muchos pequeños.
      </caption>
      <thead>
        <tr>
          <th>{AGRUPACIONES.find(a => a.id === agruparPor)?.etiqueta ?? 'Grupo'}</th>
          <th>Entregas</th><th>Cargado</th><th>Recibido</th>
          <th>Diferencia</th><th>Merma</th><th>Revisión</th>
        </tr>
      </thead>
      <tbody>
        {filas.map(f => (
          <tr key={String(f.grupo)}>
            <td>{f.grupo}</td>
            <td className={estilos.num}>{entero(f.entregas)}</td>
            <td className={estilos.num}>{miles(f.volumenCargado)}</td>
            <td className={estilos.num}>{miles(f.volumenRecibido)}</td>
            <td className={estilos.num}>{miles(f.diferenciaTotal)}</td>
            <td className={estilos.num}>{porcentaje(f.mermaPorcentaje)}</td>
            {/* Una merma grande ya resuelta y otra sin mirar no son el mismo
                problema, y la columna es lo que los separa. */}
            <td>{Number(f.pendientesDeAprobar) > 0
              ? `${entero(f.pendientesDeAprobar)} sin aprobar`
              : 'al día'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * §14.1 · Recorridos, con el odómetro enfrentado al GPS.
 *
 * El §10.1 pide las dos medidas y su diferencia. Importa porque el odómetro se
 * escribe a mano y el GPS no: una diferencia sistemática en la misma unidad o
 * el mismo conductor es exactamente lo que la comparación existe para enseñar.
 */
function Recorridos({ filas }: { filas: Fila[] }) {
  if (filas.length === 0) {
    return <p className={estilos.vacio}>Ningún viaje cerrado con odómetro registrado todavía.</p>;
  }
  return (
    <table className={estilos.tabla}>
      <thead>
        <tr>
          <th>Viaje</th><th>Conductor</th><th>Odóm. inicial</th><th>Odóm. final</th>
          <th>Km odómetro</th><th>Km GPS</th><th>Diferencia</th><th>Duración</th>
        </tr>
      </thead>
      <tbody>
        {filas.map(f => {
          const km = Number(f.kilometros ?? 0);
          const gps = f.kilometrosGps == null ? null : Number(f.kilometrosGps);
          return (
            <tr key={String(f.id)}>
              <td>{f.codigoViaje}</td>
              <td>{f.conductor ?? '—'}</td>
              <td className={estilos.num}>{miles(f.odometroInicial)}</td>
              <td className={estilos.num}>{miles(f.odometroFinal)}</td>
              <td className={estilos.num}>{miles(km)}</td>
              <td className={estilos.num}>{gps == null ? '—' : miles(gps)}</td>
              <td className={estilos.num}>{gps == null ? '—' : miles(gps - km)}</td>
              <td className={estilos.num}>{duracion(f.duracionSegundos)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const entero = (v: unknown) => String(Number(v ?? 0));

function miles(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('es-PA', { maximumFractionDigits: 2 }) : '—';
}

function porcentaje(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? `${n.toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`
    : '—';
}

/** En horas y minutos: nadie lee 30 600 segundos como ocho horas y media. */
function duracion(segundos: unknown): string {
  const s = Number(segundos);
  if (!Number.isFinite(s) || s <= 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
