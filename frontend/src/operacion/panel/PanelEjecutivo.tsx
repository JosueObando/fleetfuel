'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/api/cliente';
import type { Fila } from '@/api/tipos';
import { Campo } from '@/componentes/Campo/Campo';
import { BloqueDato } from '@/operacion/BloqueDato';
import { mensajeDeError } from '@/operacion/useBandeja';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from './panel.module.css';

/**
 * §15.1 · Dashboard ejecutivo: las ocho tarjetas superiores, de un día.
 *
 * Los números los agrega el backend en una consulta (`GET /informes/ejecutivo`);
 * aquí no se suma nada. Lo que decide la pantalla es lo que cada número NO dice
 * por sí solo:
 *
 * · de qué medida salen los kilómetros —GPS u odómetro—, porque sin la app del
 *   conductor (2A) casi no llega GPS y un 0 diario no informaría de nada;
 * · qué NO incluyen los gastos, porque «costos del día» completos son la Fase 3;
 * · que el margen no existe todavía, en vez de inventarle un porcentaje;
 * · que las alertas altas siguen ahí aunque no haya críticas.
 *
 * Y a dónde se va a actuar: un panel que enseña «1 gasto por aprobar» y obliga a
 * buscar la bandeja en el menú es un panel que se mira y no se usa.
 *
 * HOY SE ACTUALIZA SOLO
 *
 * El §23 pide «paneles con actualización automática». Sólo sin `?fecha`: un día
 * elegido es un día pasado o futuro y no cambia cada minuto. Si un refresco
 * falla se CONSERVA el último dato con su hora — vaciar el panel por un corte de
 * un minuto sería peor que enseñar datos de hace un minuto sabiendo que lo son.
 */

export const REFRESCO_MS = 60_000;

export function PanelEjecutivo() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fecha = params.get('fecha') ?? '';

  /* Lo cargado va con el día al que corresponde y se deriva comparando, igual
     que en Informes: una respuesta tardía de otro día no se pinta nunca. */
  const [cargado, setCargado] =
    useState<{ fecha: string; datos: Fila; hora: number } | null>(null);
  const [fallo, setFallo] = useState<{ fecha: string; mensaje: string } | null>(null);
  const actual = cargado?.fecha === fecha ? cargado : null;
  const error = fallo?.fecha === fecha ? fallo.mensaje : null;

  useEffect(() => {
    let vigente = true;
    const pedir = () => api.obtener<Fila>(`/informes/ejecutivo${fecha ? `?fecha=${fecha}` : ''}`)
      .then(datos => {
        if (!vigente) return;
        setCargado({ fecha, datos, hora: Date.now() });
        setFallo(null);
      })
      .catch(e => {
        if (!vigente) return;
        setFallo({ fecha, mensaje: mensajeDeError(e, 'No se pudo cargar el panel') });
      });

    void pedir();
    if (fecha) return () => { vigente = false; };
    const intervalo = window.setInterval(() => { void pedir(); }, REFRESCO_MS);
    return () => { vigente = false; window.clearInterval(intervalo); };
  }, [fecha]);

  const elegirDia = useCallback((valor: string) => {
    const p = new URLSearchParams(params.toString());
    if (valor) p.set('fecha', valor); else p.delete('fecha');
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const ir = (e: React.MouseEvent, destino: string) => {
    // Con el enlace de verdad debajo: abrir en otra pestaña o copiarlo sigue funcionando.
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    router.push(destino);
  };
  const enlace = (destino: string, texto: string) => (
    <a className={estilos.enlace} href={destino} onClick={e => ir(e, destino)}>{texto}</a>
  );

  return (
    <section className={catalogo.panel}>
      <div className={catalogo.barra}>
        <h1 className={catalogo.titulo}>Panel ejecutivo</h1>
      </div>

      <div className={catalogo.cuerpo}>
        <div className={estilos.introduccion}>
          <p className={estilos.descripcion}>Resumen operativo del día: actividad, entregas, gastos y alertas.</p>
          <span className={estilos.frecuencia}>{fecha ? "Consulta histórica" : "Actualización automática cada minuto"}</span>
        </div>
        <div className={estilos.cabecera}>
          <Campo etiqueta="Día" tipo="date" valor={fecha} onCambio={elegirDia}
                 ayuda="Sin fecha se muestra hoy y se actualiza cada minuto." />
          {fecha && <button type="button" className={estilos.volverHoy} onClick={() => elegirDia("")}>Volver a hoy</button>}
          {actual && (
            <p className={estilos.sello} role="status">
              Datos del {diaEscrito(String(actual.datos.fecha))}
              {!fecha && ` · actualizado a las ${horaEscrita(actual.hora)}`}
            </p>
          )}
        </div>

        {error && (
          <div role="alert" className={estilos.aviso}>
            <p className={catalogo.aviso}>
              {actual
                ? `No se pudo actualizar el panel: los datos son de las ${horaEscrita(actual.hora)}`
                : error}
            </p>
          </div>
        )}

        {actual ? <Tarjetas d={actual.datos} enlace={enlace} />
          : !error && (
            <div className={estilos.tarjetas} role="status" aria-label="Cargando indicadores del panel">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} aria-hidden="true" className={`${catalogo.esqueleto} ${estilos.esqueleto}`} />
              ))}
            </div>
          )}
      </div>
    </section>
  );
}

/* Sin `?? 0` en ningún campo: la API da ceros y nunca null («sin datos devuelve
   ceros, no null», en `informes.integracion.ts`). Un respaldo aquí sería una
   rama que ningún dato real alcanza. */
function Tarjetas({ d, enlace }: {
  d: Fila; enlace: (destino: string, texto: string) => React.ReactNode;
}) {
  const unidades = Number(d.unidadesConGps);
  const criticas = Number(d.alertasCriticas);
  const altas = Number(d.alertasAltas);

  return (
    <div className={estilos.tarjetas}>
      <BloqueDato rotulo="Órdenes activas" dato={entero(d.ordenesActivas)}
                  detalle="sin cerrar, cancelar ni rechazar">
        {enlace('/operacion/ordenes', 'Ver órdenes')}
      </BloqueDato>

      <BloqueDato rotulo="Viajes en curso" dato={entero(d.viajesEnCurso)}
                  detalle="fuera del patio ahora mismo">
        {enlace('/operacion/despacho', 'Ir a despacho')}
      </BloqueDato>

      <BloqueDato rotulo="Volumen entregado" dato={`${cifra(d.volumenEntregado, 2)} L`}
                  detalle="lo transportado que las estaciones recibieron ese día" />

      {/* Dos medidas y nunca su suma: sumar GPS y odómetro contaría dos veces
          los viajes que tienen las dos. */}
      <BloqueDato rotulo="Kilómetros del día"
                  dato={`${cifra(unidades > 0 ? d.kilometrosGps : d.kilometrosOdometro, 1)} km`}
                  detalle={unidades > 0
                    ? `por GPS, de ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`
                    : 'por odómetro de los viajes cerrados; ninguna unidad envió GPS'} />

      <BloqueDato rotulo="Gastos del día" dato={dinero(d.gastosDelDia)}
                  detalle={`${entero(d.gastosPorAprobar)} por aprobar · sin combustible del `
                    + 'cabezal ni mantenimiento (Fase 3)'}>
        {enlace('/operacion/gastos', 'Aprobar gastos')}
      </BloqueDato>

      <BloqueDato rotulo="Margen promedio" dato="—"
                  detalle="necesita ingreso y costo completo: motor de costos (Fase 3)" />

      <BloqueDato rotulo="Conductores pendientes de pago" dato={entero(d.conductoresPendientesPago)}
                  detalle={`${dinero(d.montoPendientePago)} por pagar`}>
        {enlace('/operacion/liquidaciones', 'Ver liquidaciones')}
      </BloqueDato>

      <BloqueDato rotulo="Alertas críticas" dato={entero(criticas)} resaltado={criticas > 0}
                  detalle={criticas > 0
                    ? `sin resolver${altas > 0 ? ` · y ${altas} de severidad alta` : ''}`
                    : altas > 0 ? `ninguna crítica · ${altas} de severidad alta`
                      : 'ninguna crítica ni alta'}>
        {enlace('/operacion/alertas', 'Ver alertas')}
      </BloqueDato>
    </div>
  );
}

const entero = (v: unknown) => String(Number(v));

const cifra = (v: unknown, decimales: number) =>
  Number(v).toLocaleString('es-PA', { maximumFractionDigits: decimales });

const dinero = (v: unknown) =>
  Number(v).toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** «2033-03-15» → «15 de marzo de 2033», sin pasar por la zona de quien mira. */
function diaEscrito(iso: string) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d))
    .toLocaleDateString('es-PA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const horaEscrita = (ms: number) =>
  new Date(ms).toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
