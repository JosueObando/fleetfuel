'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, ErrorApi } from '@/api/cliente';
import type { Fila } from '@/api/tipos';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from '../bandeja.module.css';

/**
 * §22 · La bandeja de alertas.
 *
 * El backend detecta, deduplica y ordena por gravedad. Esta pantalla no
 * reordena nada —una pérdida de GPS de hace un minuto no puede subir por
 * encima de un sello roto de hace una hora— y separa dos gestos que se parecen
 * y no son lo mismo: RECONOCER («la he visto y me encargo») y RESOLVER («ya no
 * hay problema», con motivo). Si fueran el mismo botón, lo visto pasaría por
 * arreglado.
 */

/* Sin respaldo para valores desconocidos: `ck_alertas_severidad` y
   `ck_alertas_estado` sólo admiten estos, y una rama que ningún dato puede
   recorrer se quita, no se cubre. */
const GRAVEDAD: Record<string, string> = {
  critica: 'Crítica', alta: 'Alta', media: 'Media', baja: 'Baja',
};
const ESTADO: Record<string, string> = {
  abierta: 'Abierta', reconocida: 'Reconocida', resuelta: 'Resuelta',
};
/** El mismo mínimo que `ResolverAlertaDto`: pedirlo aquí evita un 400 evitable. */
const MOTIVO_MINIMO = 5;

const mensaje = (e: unknown, porDefecto: string) =>
  e instanceof ErrorApi ? e.message : porDefecto;

const cuando = (v: unknown) => new Date(String(v)).toLocaleString('es-PA', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Panama',
});

/* `alertas.detalle` es JSONB y cada tipo trae sus claves. Se nombran las
   conocidas; una desconocida se enseña con su nombre crudo, porque el backend
   puede añadir un dato sin tocar esta pantalla y esconderlo lo haría
   desaparecer justo cuando es nuevo. */
const ROTULOS: Record<string, string> = {
  maxima: 'Velocidad máxima', umbral: 'Umbral', lecturas: 'Lecturas',
  ultima: 'Última posición', silencioSegundos: 'Sin señal',
  estadoSello: 'Estado del sello', sello: 'Sello recibido',
  porcentajeMerma: 'Merma', diferencia: 'Diferencia',
  vence: 'Vence', vencida: 'Vencida', fechaProgramada: 'Programado para',
  monto: 'Monto', categoria: 'Categoría',
};

const numero = (v: unknown) => Number(v).toLocaleString('es-PA', { maximumFractionDigits: 2 });

function valorLegible(clave: string, v: unknown): string {
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (clave === 'silencioSegundos') return `${Math.round(Number(v) / 60)} min`;
  if (clave === 'maxima' || clave === 'umbral') return `${numero(v)} km/h`;
  if (clave === 'porcentajeMerma') {
    return `${Number(v).toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
  }
  if (clave === 'ultima' || clave === 'fechaProgramada') return cuando(v);
  if (clave === 'vence') return String(v).slice(0, 10);
  if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))) {
    return numero(v);
  }
  return String(v);
}

function Detalle({ id, detalle }: { id: string; detalle: unknown }) {
  const pares = Object.entries((detalle ?? {}) as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined);
  if (pares.length === 0) return null;
  return (
    <dl className={estilos.datos}>
      {pares.map(([clave, v]) => (
        <div key={clave} className={estilos.dato}>
          <dt id={`${id}-${clave}`}>{ROTULOS[clave] ?? clave}</dt>
          <dd aria-labelledby={`${id}-${clave}`}>{valorLegible(clave, v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** «Hecho» a secas no distingue una pasada que no encontró nada de una que no corrió. */
export function resumenDeEvaluacion({ evaluadas, nuevas, yaAbiertas }:
  { evaluadas: number; nuevas: number; yaAbiertas: number }) {
  if (evaluadas === 0) return 'La evaluación no encontró nada que alertar.';
  if (nuevas === 0) return `Nada nuevo: las ${yaAbiertas} que encontró ya estaban abiertas.`;
  const primera = nuevas === 1 ? '1 alerta nueva.' : `${nuevas} alertas nuevas.`;
  return yaAbiertas > 0 ? `${primera} Otras ${yaAbiertas} ya estaban abiertas.` : primera;
}

export function Alertas() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const todas = params.get('ver') === 'todas';

  /* Los datos se guardan JUNTO a la consulta que los pidió y se comparan al
     pintar, igual que en Informes: si alguien alterna «ver resueltas» rápido,
     la respuesta tardía de la consulta anterior no se pinta bajo la nueva. */
  const consultaActual = todas ? '/alertas?estado=todas' : '/alertas';
  const [cargado, setCargado] = useState<{ consulta: string; filas: Fila[] } | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [evaluando, setEvaluando] = useState(false);
  const filas = cargado?.consulta === consultaActual ? cargado.filas : null;

  useEffect(() => {
    let vigente = true;
    api.listar<Fila>(consultaActual)
      .then(f => { if (vigente) { setCargado({ consulta: consultaActual, filas: f }); setError(null); } })
      .catch(e => {
        if (!vigente) return;
        setError(mensaje(e, 'No se pudieron cargar las alertas'));
        setCargado({ consulta: consultaActual, filas: [] });
      });
    return () => { vigente = false; };
  }, [consultaActual, version]);

  const recargar = () => setVersion(v => v + 1);

  const verTodas = useCallback((si: boolean) => {
    const p = new URLSearchParams(params.toString());
    if (si) p.set('ver', 'todas'); else p.delete('ver');
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  async function actuar(fn: () => Promise<unknown>) {
    setError(null); setResultado(null);
    try { await fn(); recargar(); }
    catch (e) { setError(mensaje(e, 'No se pudo completar la acción')); }
  }

  async function evaluar() {
    setEvaluando(true); setError(null); setResultado(null);
    try {
      const r = await api.crear<Fila>('/alertas/evaluar', {});
      setResultado(resumenDeEvaluacion(r as { evaluadas: number; nuevas: number; yaAbiertas: number }));
      recargar();
    } catch (e) {
      setError(mensaje(e, 'No se pudo evaluar'));
    } finally {
      setEvaluando(false);
    }
  }

  return (
    <section className={catalogo.panel}>
      <div className={catalogo.barra}>
        <h1 className={catalogo.titulo}>Alertas</h1>
        <Button onClick={() => void evaluar()} cargando={evaluando}>Evaluar ahora</Button>
      </div>

      <div className={catalogo.cuerpo}>
        <label className={estilos.casilla}>
          <input type="checkbox" checked={todas} onChange={e => verTodas(e.target.checked)} />
          Ver también las resueltas
        </label>

        {error && <p role="alert" className={catalogo.aviso}>{error}</p>}
        {resultado && <p role="status" className={estilos.resultado}>{resultado}</p>}

        {filas === null ? (
          <>{[0, 1, 2].map(i => <div key={i} className={catalogo.esqueleto} />)}</>
        ) : filas.length === 0 ? (
          !error && <p className={catalogo.vacio}>
            {todas ? 'Ninguna alerta registrada.' : 'Ninguna alerta abierta.'}
          </p>
        ) : (
          <ul className={estilos.lista}>
            {filas.map(a => (
              <li key={String(a.id)} className={`${estilos.elemento} ${estilos[String(a.severidad)]}`}>
                <div className={estilos.cabecera}>
                  <span className={estilos.gravedad}>{GRAVEDAD[String(a.severidad)]}</span>
                  <h2 className={estilos.titulo}>{String(a.titulo)}</h2>
                  <span className={estilos.estado}>{ESTADO[String(a.estado)]}</span>
                </div>
                <Detalle id={`alerta-${String(a.id)}`} detalle={a.detalle} />
                <p className={estilos.meta}>Detectada {cuando(a.detectadaEn)}</p>

                {a.estado === 'resuelta' ? (
                  <p className={estilos.cierre}>{String(a.motivoCierre)}</p>
                ) : (
                  <div className={estilos.acciones}>
                    {a.estado === 'abierta' && (
                      <Button variante="secundario"
                              onClick={() => void actuar(() => api.crear(`/alertas/${a.id}/reconocer`, {}))}>
                        Reconocer
                        <span className="solo-lectores"> {String(a.titulo)}</span>
                      </Button>
                    )}
                    <ResolverAlerta alerta={a}
                                    onResolver={motivo => actuar(() =>
                                      api.crear(`/alertas/${a.id}/resolver`, { motivo }))} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ResolverAlerta({ alerta, onResolver }: {
  alerta: Fila; onResolver: (motivo: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  return (
    <span className={estilos.resolver}>
      <Campo etiqueta="Motivo del cierre" valor={motivo} onCambio={setMotivo} />
      <Button deshabilitado={motivo.trim().length < MOTIVO_MINIMO}
              onClick={() => void onResolver(motivo.trim())}>
        Resolver
        <span className="solo-lectores"> {String(alerta.titulo)}</span>
      </Button>
    </span>
  );
}
