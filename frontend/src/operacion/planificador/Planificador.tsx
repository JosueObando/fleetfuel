'use client';

import { useCallback, useId, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, ErrorApi } from '@/api/cliente';
import { useCargaInicial } from '@/api/carga';
import { Button } from '@/componentes/Button/Button';
import { TablaDesplazable } from '@/componentes/TablaDesplazable/TablaDesplazable';
import { diaDeFin } from '@/app/operacion/viajes/fechas';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from './planificador.module.css';
import {
  cronograma, hoyUtc, lunesDe, sumarDias, ventanaDe,
  type Bloque, type CisternaPlan, type ViajePlan,
} from './cronograma';

/**
 * §15.3 · Planificador de viajes: una semana, una fila por cisterna.
 *
 * Existe para contestar dos preguntas antes de autorizar: qué cisterna está
 * libre y qué viajes tienen algo sin asignar. Lo primero lo enseñan los huecos
 * de cada fila; lo segundo, la lista de conflictos, que es también la versión
 * en texto del cronograma para quien no lo ve.
 *
 * La semana vive en la URL (`?desde=`): una planificación se comenta por
 * mensaje, «mira la semana del 8».
 */

const SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
               'septiembre', 'octubre', 'noviembre', 'diciembre'];

const partes = (dia: string) => {
  const d = new Date(dia);
  return { dia: d.getUTCDate(), mes: MESES[d.getUTCMonth()], anio: d.getUTCFullYear() };
};

/** «del 2 al 4 de marzo», «del 30 de marzo al 2 de abril», con o sin año. */
function tramo(primero: string, ultimo: string, conAnio: boolean): string {
  const a = partes(primero), b = partes(ultimo);
  const anio = (p: { anio: number }) => (conAnio ? ` de ${p.anio}` : '');
  if (a.anio !== b.anio) return `del ${a.dia} de ${a.mes}${anio(a)} al ${b.dia} de ${b.mes}${anio(b)}`;
  if (a.mes !== b.mes) return `del ${a.dia} de ${a.mes} al ${b.dia} de ${b.mes}${anio(b)}`;
  return `del ${a.dia} al ${b.dia} de ${b.mes}${anio(b)}`;
}

const listaEs = new Intl.ListFormat('es', { type: 'conjunction' });

/** Todo lo que el bloque enseña con su color y su posición, dicho con palabras. */
function nombreDelBloque(b: Bloque): string {
  const v = b.viaje;
  const salida = (v.fechaInicio ?? v.fechaProgramada).slice(0, 10);
  let cuando: string;
  if (!v.fechaFin) {
    const p = partes(salida);
    cuando = `desde el ${p.dia} de ${p.mes} sin fin previsto`;
  } else {
    const ultimo = diaDeFin(v.fechaFin);
    const p = partes(salida);
    cuando = ultimo === salida ? `el ${p.dia} de ${p.mes}` : tramo(salida, ultimo, false);
  }
  return [
    v.codigoViaje,
    v.estado.replaceAll('_', ' '),
    cuando,
    v.conductor ?? 'sin conductor',
    v.destinos.length ? `a ${listaEs.format(v.destinos)}` : 'sin destinos',
    ...(b.cortaInicio ? ['empezó antes de esta semana'] : []),
    ...(b.cortaFin && v.fechaFin ? ['sigue después de esta semana'] : []),
  ].join(', ');
}

const esDia = (texto: string | null) => !!texto && /^\d{4}-\d{2}-\d{2}$/.test(texto) && !Number.isNaN(Date.parse(texto));

export function Planificador() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const idConflictos = useId();

  /* Un ?desde que no es una fecha no llega a la API: abre la semana de hoy. */
  const pedido = params.get('desde');
  const lunes = lunesDe(esDia(pedido) ? pedido! : hoyUtc());
  const ventana = ventanaDe(lunes);
  const consulta = `/viajes?desde=${ventana.desde}&hasta=${ventana.hasta}`;

  /* Los datos se guardan JUNTO a la consulta que los pidió: al cambiar de
     semana, la anterior no se enseña bajo el título nuevo mientras llega. */
  const [datos, setDatos] =
    useState<{ consulta: string; viajes: ViajePlan[]; cisternas: CisternaPlan[] } | null>(null);
  const [fallo, setFallo] = useState<{ consulta: string; mensaje: string } | null>(null);

  const cargar = useCallback(async (vigente: () => boolean) => {
    try {
      const [viajes, cisternas] = await Promise.all([
        api.listar<ViajePlan>(consulta), api.listar<CisternaPlan>('/cisternas'),
      ]);
      if (!vigente()) return;
      setDatos({ consulta, viajes, cisternas });
    } catch (e) {
      if (!vigente()) return;
      setFallo({ consulta, mensaje: e instanceof ErrorApi ? e.message : 'No se pudo cargar la semana' });
    }
  }, [consulta]);
  useCargaInicial(cargar);

  const vistos = datos?.consulta === consulta ? datos : null;
  const error = fallo?.consulta === consulta ? fallo.mensaje : null;
  const crono = vistos ? cronograma(vistos.viajes, vistos.cisternas, ventana) : null;

  const irA = (dia: string) => {
    const p = new URLSearchParams(params.toString());
    p.set('desde', dia);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const abrir = (e: React.MouseEvent, viajeId: string) => {
    // Con el enlace de verdad debajo: abrir en otra pestaña o copiarlo sigue funcionando.
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    router.push(`/operacion/despacho?viaje=${viajeId}`);
  };

  const ultimoDia = ventana.dias[ventana.dias.length - 1];
  const rango = tramo(lunes, ultimoDia, true);

  return (
    <section className={catalogo.panel}>
      <div className={`${catalogo.barra} ${estilos.barra}`}>
        <h1 className={catalogo.titulo}>Planificador</h1>
        <div className={estilos.navegacion}>
          <Button variante="secundario" onClick={() => irA(sumarDias(lunes, -7))}>Semana anterior</Button>
          <Button variante="secundario" onClick={() => irA(lunesDe(hoyUtc()))}>Esta semana</Button>
          <Button variante="secundario" onClick={() => irA(sumarDias(lunes, 7))}>Semana siguiente</Button>
        </div>
      </div>

      <div className={catalogo.cuerpo}>
        <p className={estilos.rango}>{rango.charAt(0).toUpperCase() + rango.slice(1)}</p>

        {error ? (
          <p className={catalogo.aviso} role="alert">{error}</p>
        ) : !crono ? (
          <>{[0, 1, 2].map(i => <div key={i} className={catalogo.esqueleto} />)}</>
        ) : crono.filas.length === 0 ? (
          <p className={catalogo.vacio}>No hay cisternas ni viajes que planificar esta semana.</p>
        ) : (
          <TablaDesplazable etiqueta="Viajes por cisterna">
            <table className={estilos.tabla} aria-label="Viajes por cisterna">
              <thead>
                <tr>
                  <th scope="col" className={estilos.cabeceraFila}>Cisterna</th>
                  {ventana.dias.map(d => (
                    <th key={d} scope="col" className={estilos.dia}>
                      {`${SEMANA[new Date(d).getUTCDay()]} ${new Date(d).getUTCDate()}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {crono.filas.map(f => (
                  <tr key={f.clave || 'sin-cisterna'}>
                    <th scope="row" className={estilos.cabeceraFila}>{f.titulo}</th>
                    <td colSpan={ventana.dias.length} className={estilos.pista}>
                      {f.bloques.map(b => (
                        <a key={b.viaje.id} href={`/operacion/despacho?viaje=${b.viaje.id}`}
                           onClick={e => abrir(e, b.viaje.id)}
                           aria-label={nombreDelBloque(b)}
                           className={[estilos.bloque, estilos[b.grupo],
                                       b.cortaInicio ? estilos.cortaInicio : '',
                                       b.cortaFin ? estilos.cortaFin : ''].join(' ')}
                           style={{ left: `${b.izquierda}%`, width: `${b.ancho}%` }}>
                          <span className={estilos.codigo}>{b.viaje.codigoViaje}</span>
                          <span className={estilos.detalle}>{b.viaje.conductor ?? 'sin conductor'}</span>
                        </a>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TablaDesplazable>
        )}

        {crono && !error && (
          <section className={estilos.conflictos} aria-labelledby={idConflictos}>
            <h2 id={idConflictos} className={estilos.tituloConflictos}>
              Conflictos de asignación · {crono.conflictos.length}
            </h2>
            {crono.conflictos.length === 0 ? (
              <p className={catalogo.vacio}>Ningún conflicto en esta semana.</p>
            ) : (
              <ul className={estilos.listaConflictos}>
                {crono.conflictos.map(c => (
                  <li key={`${c.viaje.id}-${c.tipo}`}>
                    <a href={`/operacion/despacho?viaje=${c.viaje.id}`} onClick={e => abrir(e, c.viaje.id)}>
                      {`${c.viaje.codigoViaje} — ${c.texto}`}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
