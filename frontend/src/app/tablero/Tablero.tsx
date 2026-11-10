'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { PanelHeader } from '@/componentes/PanelHeader/PanelHeader';
import { FilterChip } from '@/componentes/FilterChip/FilterChip';
import { SegmentedControl } from '@/componentes/SegmentedControl/SegmentedControl';
import { ShipmentCard } from '@/componentes/ShipmentCard/ShipmentCard';
import { DetailHeader } from '@/componentes/DetailHeader/DetailHeader';
import { Tabs } from '@/componentes/Tabs/Tabs';
import { CapacityGauge } from '@/componentes/CapacityGauge/CapacityGauge';
import { SectionHeader } from '@/componentes/SectionHeader/SectionHeader';
import { MapView } from '@/componentes/MapView/MapView';
import { PhotoStrip } from '@/componentes/PhotoStrip/PhotoStrip';
import { RequestList } from '@/componentes/RequestList/RequestList';
import { Button } from '@/componentes/Button/Button';
import { Icon, type NombreIcono } from '@/componentes/Icon/Icon';
import { Sidebar } from './Sidebar';
import { ENVIOS, SOCIOS, ACTIVOS } from './datos';
import estilos from './tablero.module.css';

/*
 * Todo el estado de la vista vive en la URL, no en useState.
 *
 * El spec lo pide explícitamente: `?partners=a,b&show=active&selected=SD-…`
 * para que la vista sea compartible y sobreviva a una recarga. El efecto de
 * segundo orden es que no hay estado duplicado: la URL es la única fuente de
 * verdad y el botón «atrás» del navegador funciona gratis.
 */
const FOTOS = [
  { id: 'f1', titulo: 'Descarga', direccion: 'Vía España',  hora: '14:32', estado: 'ok' as const },
  { id: 'f2', titulo: 'Sello',    direccion: 'San Miguelito', hora: '15:10', estado: 'pendiente' as const },
];

const DESTINOS: Array<{ id: string; etiqueta: string; icono: NombreIcono; ruta: string }> = [
  { id: 'seguimiento', etiqueta: 'Seguimiento', icono: 'seguimiento', ruta: '/tablero' },
  { id: 'flota',       etiqueta: 'Flota',       icono: 'flota', ruta: '/catalogos/vehiculos' },
  { id: 'conductores', etiqueta: 'Conductores', icono: 'conductores', ruta: '/catalogos/conductores' },
  { id: 'ordenes',     etiqueta: 'Órdenes',     icono: 'ordenes', ruta: '/operacion/ordenes' },
  { id: 'informes',    etiqueta: 'Informes',    icono: 'informes', ruta: '/operacion/informes' },
];

export function Tablero() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const socios = useMemo(
    () => (params.get('partners') ?? '').split(',').filter(Boolean),
    [params]);
  const muestra = params.get('show') ?? 'todos';
  const seleccionado = params.get('selected');
  const pestana = params.get('tab') ?? 'resumen';

  /* Escribir en la URL sin recargar. `scroll: false` para que cambiar de
     filtro no salte al principio de la lista. */
  const fijar = useCallback((clave: string, valor: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (valor === null || valor === '') p.delete(clave); else p.set(clave, valor);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  const alternarSocio = (id: string) =>
    fijar('partners', (socios.includes(id) ? socios.filter(s => s !== id) : [...socios, id]).join(','));

  const visibles = useMemo(() => ENVIOS.filter(e => {
    if (socios.length && !socios.includes(e.socio)) return false;
    if (muestra === 'activos'   && !ACTIVOS.includes(e.estado)) return false;
    if (muestra === 'inactivos' &&  ACTIVOS.includes(e.estado)) return false;
    return true;
  }), [socios, muestra]);

  const envio = ENVIOS.find(e => e.id === seleccionado) ?? null;
  const conteo = (id: string) => ENVIOS.filter(e => e.socio === id).length;

  return (
    <div className={estilos.shell} data-vista={envio ? 'detalle' : 'lista'}>
      <Sidebar />

      <section className={estilos.tracking} aria-label="Seguimiento de la flota">
        <PanelHeader titulo="Seguimiento" />

        {/* El plan pide que lo diferido se marque como diferido y NO se deje
            dibujado como si funcionara. Seis camiones inventados con su ETA y
            su porcentaje de carga no son una pantalla vacía: son una pantalla
            que miente con el aplomo de un dato real. Hasta el 2026-09-12 ésta
            era además la primera pantalla del dominio, servida sin sesión.

            `note` y no `status`: el aviso no aparece, está — una región viva lo
            anunciaría en cada render para decir algo que no ha cambiado. */}
        <p role="note" aria-label="Boceto" className={estilos.boceto}>
          Boceto de <strong>UX-2</strong>: estos envíos son datos de muestra.
          Los reales llegan cuando cierre 2B (telemetría).
        </p>
        <FilterChip
          socios={SOCIOS.map(s => ({ ...s, conteo: conteo(s.id), activo: socios.includes(s.id) }))}
          onAlternar={alternarSocio}
        />
        <SegmentedControl
          seleccionada={muestra}
          onSeleccionar={v => fijar('show', v === 'todos' ? null : v)}
          opciones={[
            { id: 'todos',     etiqueta: 'Todos',     conteo: ENVIOS.length },
            { id: 'activos',   etiqueta: 'Activos',   conteo: ENVIOS.filter(e => ACTIVOS.includes(e.estado)).length },
            { id: 'inactivos', etiqueta: 'Inactivos', conteo: ENVIOS.filter(e => !ACTIVOS.includes(e.estado)).length },
          ]}
        />

        {/* Región viva: al filtrar, el número de resultados cambia sin que
            nada reciba el foco. Sin esto el cambio es invisible para quien
            no ve la lista. */}
        <p className="solo-lectores" aria-live="polite">
          {visibles.length} {visibles.length === 1 ? 'envío' : 'envíos'} en la lista
        </p>

        <div className={estilos.listaTarjetas}>
          {visibles.map(e => (
            <ShipmentCard
              key={e.id}
              identificador={e.id}
              estado={e.estado}
              segundosRestantes={e.segundosRestantes}
              km={e.km}
              paradas={e.paradas}
              vehiculo={e.vehiculo}
              seleccionada={e.id === seleccionado}
              onClick={() => fijar('selected', e.id)}
            />
          ))}
          {visibles.length === 0 && (
            <p className={estilos.vacio}>Ningún envío coincide con estos filtros.</p>
          )}
        </div>
      </section>

      <section className={estilos.detalle} aria-label="Detalle del envío">
        {envio ? (
          <>
            <div className={estilos.volver} style={{ padding: 'var(--esp-4) var(--esp-6) 0' }}>
              <Button variante="secundario" onClick={() => fijar('selected', null)}>
                Volver a la lista
              </Button>
            </div>
            <DetailHeader identificador={envio.id} estado={envio.estado} />
            <Tabs activa={pestana} onCambiar={v => fijar('tab', v === 'resumen' ? null : v)}
              pestanas={[
                { id: 'resumen',   etiqueta: 'Resumen' },
                { id: 'ruta',      etiqueta: 'Ruta' },
                { id: 'carga',     etiqueta: 'Carga' },
                { id: 'reportes',  etiqueta: 'Reportes' },
                { id: 'historial', etiqueta: 'Historial', deshabilitada: true },
              ]} />
            <SectionHeader
              titulo="Ruta"
              meta={`${envio.km.toFixed(1)} km restantes`}
              accion={{ etiqueta: 'Cambiar ruta' }}
            />
            <MapView resumen={`Ruta de ${envio.id} con ${envio.paradas.length} paradas.`} />
            <CapacityGauge porcentaje={envio.capacidad} />
            <SectionHeader titulo="Reportes" />
            <PhotoStrip fotos={FOTOS} />
            <RequestList solicitudes={[
              { id: 'r1', solicitud: 'Desviar por Vía Brasil', solicitante: 'Juan Pérez', hora: '15:02' },
            ]} />
          </>
        ) : (
          <p className={estilos.vacio}>Selecciona un envío para ver su detalle.</p>
        )}
      </section>

      {/* <768: tab bar de 5 destinos, alto 56, objetivos ≥44 px. */}
      <nav className={estilos.tabBar} aria-label="Destinos">
        {DESTINOS.map((d, i) => (
          <button key={d.id} type="button" className={estilos.destino}
                  onClick={() => { if (d.ruta !== pathname) router.push(d.ruta); }}
                  aria-current={d.ruta === pathname ? 'page' : undefined}>
            <Icon nombre={d.icono} tamano={20} />
            <span>{d.etiqueta}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
