'use client';

import { useState } from 'react';
import { PanelHeader } from '@/componentes/PanelHeader/PanelHeader';
import { FilterChip, type Socio } from '@/componentes/FilterChip/FilterChip';
import { SegmentedControl } from '@/componentes/SegmentedControl/SegmentedControl';
import { ShipmentCard } from '@/componentes/ShipmentCard/ShipmentCard';
import { StatusBadge } from '@/componentes/StatusBadge/StatusBadge';
import { MetricStack } from '@/componentes/MetricStack/MetricStack';
import { RouteTimeline } from '@/componentes/RouteTimeline/RouteTimeline';
import { VehicleThumb } from '@/componentes/VehicleThumb/VehicleThumb';
import estilos from './Chrome.module.css';
import propios from './Tracking.module.css';

/* Datos falsos: UX-0 construye el sistema, no pantallas con datos reales.
   Nombres del Distrito de Panamá para que las medidas se prueben con texto
   verosímil y no con «Lorem ipsum», que nunca desborda igual. */
const PARADAS = [
  { etiqueta: 'Planta Panamá Oeste', fase: 'pasada' as const },
  { etiqueta: 'Vía Ricardo J. Alfaro', fase: 'actual' as const },
  { etiqueta: 'Estación San Miguelito', fase: 'futura' as const },
  { etiqueta: 'Depósito Tocumen', fase: 'futura' as const },
];

function Celda({ nombre, nota, claro, children }: {
  nombre: string; nota?: string; claro?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={estilos.celda}>
      <div className={estilos.nombreEstado}>{nombre}</div>
      <div className={claro ? propios.lienzoClaro : estilos.lienzoSidebar}>{children}</div>
      {nota && <p className={estilos.nota}>{nota}</p>}
    </div>
  );
}

export function Tracking() {
  const [socios, setSocios] = useState<Socio[]>([
    { id: 'aseo', etiqueta: 'Aseo Urbano', conteo: 12, activo: true },
    { id: 'obras', etiqueta: 'Obras', conteo: 5 },
    { id: 'parques', etiqueta: 'Parques', conteo: 3 },
    { id: 'externo', etiqueta: 'Contratista', conteo: 0, deshabilitado: true },
  ]);
  const [muestra, setMuestra] = useState('todos');

  const alternar = (id: string) =>
    setSocios(ss => ss.map(s => (s.id === id ? { ...s, activo: !s.activo } : s)));

  return (
    <>
      <h3>6 · PanelHeader</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Reposo" claro><PanelHeader titulo="Seguimiento" /></Celda>
        <Celda nombre="Deshabilitado" claro><PanelHeader titulo="Seguimiento" deshabilitado /></Celda>
        <Celda nombre="Cargando" claro><PanelHeader titulo="Seguimiento" cargando /></Celda>
      </div>

      <h3>7 · FilterChip</h3>
      <div className={propios.anchoCompleto}>
        <div className={propios.lienzoClaro}>
          <FilterChip socios={socios} onAlternar={alternar} />
        </div>
        <p className={estilos.nota}>
          Interactivo: pulsa para alternar. Multi-selección con <code>aria-pressed</code>.
          «Contratista» está deshabilitado (conteo 0).
        </p>
      </div>

      <h3>8 · SegmentedControl</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Exclusivo" claro nota="Radios reales: navega con flechas.">
          <SegmentedControl
            seleccionada={muestra}
            onSeleccionar={setMuestra}
            opciones={[
              { id: 'todos', etiqueta: 'Todos', conteo: 20 },
              { id: 'activos', etiqueta: 'Activos', conteo: 14 },
              { id: 'inactivos', etiqueta: 'Inactivos', conteo: 6 },
            ]}
          />
        </Celda>
        <Celda nombre="Deshabilitado" claro>
          <SegmentedControl
            seleccionada="todos" deshabilitado
            opciones={[
              { id: 'todos', etiqueta: 'Todos', conteo: 0 },
              { id: 'activos', etiqueta: 'Activos', conteo: 0 },
            ]}
          />
        </Celda>
      </div>

      <h3>10 · StatusBadge &nbsp;·&nbsp; 11 · MetricStack &nbsp;·&nbsp; 12 · RouteTimeline &nbsp;·&nbsp; 13 · VehicleThumb</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Los cuatro estados" claro nota="El color nunca va solo: siempre lleva label.">
          <div className={propios.pilaBadges}>
            <StatusBadge estado="enRuta" />
            <StatusBadge estado="esperando" />
            <StatusBadge estado="retrasado" />
            <StatusBadge estado="entregado" />
          </div>
        </Celda>
        <Celda nombre="MetricStack" claro nota="Cifras tabulares: el ancho no baila.">
          <MetricStack segundosRestantes={4521} km={18.4} />
        </Celda>
        <Celda nombre="RouteTimeline" claro nota="Máx. 4 filas; la actual va en negrita.">
          <RouteTimeline paradas={PARADAS} />
        </Celda>
        <Celda nombre="VehicleThumb" claro nota="Decorativa: aria-hidden.">
          <VehicleThumb tipo="cisterna" />
        </Celda>
      </div>

      <h3>9 · ShipmentCard</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Reposo" claro>
          <ShipmentCard identificador="SD-4821-PTY" estado="enRuta" segundosRestantes={4521}
            km={18.4} paradas={PARADAS} vehiculo="cisterna" />
        </Celda>
        <Celda nombre="Seleccionada" claro nota="Borde de acción + sombra.">
          <ShipmentCard identificador="SD-4822-PTY" estado="esperando" segundosRestantes={900}
            km={3.2} paradas={PARADAS} vehiculo="camion" seleccionada />
        </Celda>
        <Celda nombre="Retrasada" claro>
          <ShipmentCard identificador="SD-4823-PTY" estado="retrasado" segundosRestantes={11400}
            km={42.7} paradas={PARADAS} vehiculo="furgoneta" />
        </Celda>
        <Celda nombre="Deshabilitada" claro>
          <ShipmentCard identificador="SD-4824-PTY" estado="entregado" segundosRestantes={0}
            km={0} paradas={PARADAS} vehiculo="cisterna" deshabilitado />
        </Celda>
        <Celda nombre="Cargando" claro nota="Bloques de 12/60/72 px, shimmer 1.2 s. Sin spinner.">
          <ShipmentCard identificador="" estado="enRuta" segundosRestantes={0}
            km={0} paradas={[]} vehiculo="cisterna" cargando />
        </Celda>
      </div>
    </>
  );
}
