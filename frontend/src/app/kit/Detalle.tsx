'use client';

import { useState } from 'react';
import { DetailHeader } from '@/componentes/DetailHeader/DetailHeader';
import { Button } from '@/componentes/Button/Button';
import { Tabs } from '@/componentes/Tabs/Tabs';
import { CapacityGauge } from '@/componentes/CapacityGauge/CapacityGauge';
import { SectionHeader } from '@/componentes/SectionHeader/SectionHeader';
import { MapView } from '@/componentes/MapView/MapView';
import { MapControl } from '@/componentes/MapControl/MapControl';
import { PhotoStrip } from '@/componentes/PhotoStrip/PhotoStrip';
import { PhotoCard } from '@/componentes/PhotoCard/PhotoCard';
import { ActionTile } from '@/componentes/ActionTile/ActionTile';
import { RequestList, type Solicitud } from '@/componentes/RequestList/RequestList';
import estilos from './Chrome.module.css';
import propios from './Tracking.module.css';

const FOTOS = [
  { id: 'f1', titulo: 'Descarga', direccion: 'Vía España', hora: '14:32', estado: 'ok' as const },
  { id: 'f2', titulo: 'Sello', direccion: 'San Miguelito', hora: '15:10', estado: 'pendiente' as const },
  { id: 'f3', titulo: 'Derrame', direccion: 'Tocumen', hora: '15:48', estado: 'problema' as const },
];

function Celda({ nombre, nota, ancho, children }: {
  nombre: string; nota?: string; ancho?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`${estilos.celda} ${ancho ? propios.anchoCompleto : ''}`}>
      <div className={estilos.nombreEstado}>{nombre}</div>
      <div className={propios.lienzoClaro}>{children}</div>
      {nota && <p className={estilos.nota}>{nota}</p>}
    </div>
  );
}

export function Detalle() {
  const [pestana, setPestana] = useState('resumen');
  // Anotado: sin el tipo explícito, TS infiere resolucion: 'aprobada' del
  // literal inicial y rechaza 'rechazada' al actualizar.
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([
    { id: 'r1', solicitud: 'Desviar por Vía Brasil', solicitante: 'Juan Pérez', hora: '15:02' },
    { id: 'r2', solicitud: 'Añadir parada en Betania', solicitante: 'Ana Gómez', hora: '15:20' },
    { id: 'r3', solicitud: 'Cambiar a ruta corta', solicitante: 'Luis Him', hora: '14:44',
      resolucion: 'aprobada' },
  ]);

  const resolver = (id: string, resolucion: 'aprobada' | 'rechazada') =>
    setSolicitudes(ss => ss.map(s => (s.id === id ? { ...s, resolucion } : s)));

  return (
    <>
      <h3>15 · DetailHeader</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Reposo" ancho><DetailHeader identificador="SD-4821-PTY" estado="enRuta" /></Celda>
        <Celda nombre="Llamando" ancho nota="El girador sustituye al icono: el botón no cambia de ancho.">
          <DetailHeader identificador="SD-4821-PTY" estado="enRuta" llamandoEnCurso />
        </Celda>
        <Celda nombre="Deshabilitado" ancho><DetailHeader identificador="SD-4824-PTY" estado="entregado" deshabilitado /></Celda>
      </div>

      <h3>16 · Button</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Primario"><Button icono="telefono">Llamar al conductor</Button></Celda>
        <Celda nombre="Secundario"><Button variante="secundario" icono="ordenes">Cambiar ruta</Button></Celda>
        <Celda nombre="Cargando"><Button cargando>Enviando</Button></Celda>
        <Celda nombre="Deshabilitado"><Button deshabilitado icono="telefono">Llamar</Button></Celda>
        <Celda nombre="Secundario deshabilitado"><Button variante="secundario" deshabilitado>Cambiar ruta</Button></Celda>
      </div>

      <h3>17 · Tabs</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Interactivo" ancho nota="Una sola parada de tabulación; navega con ← →.">
          <Tabs activa={pestana} onCambiar={setPestana} pestanas={[
            { id: 'resumen', etiqueta: 'Resumen' },
            { id: 'ruta', etiqueta: 'Ruta' },
            { id: 'carga', etiqueta: 'Carga' },
            { id: 'reportes', etiqueta: 'Reportes' },
            { id: 'historial', etiqueta: 'Historial', deshabilitada: true },
          ]} />
        </Celda>
      </div>

      <h3>18 · CapacityGauge</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Bajo · 28 %" nota="&lt;40 %: relleno neutro, número oscuro."><CapacityGauge porcentaje={28} /></Celda>
        <Celda nombre="Normal · 64 %"><CapacityGauge porcentaje={64} /></Celda>
        <Celda nombre="Alto · 94 %" nota="≥90 %: ámbar + «Casi lleno»."><CapacityGauge porcentaje={94} /></Celda>
        <Celda nombre="Sobrepeso · 108 %" nota="Recorta el relleno y avisa."><CapacityGauge porcentaje={108} /></Celda>
      </div>

      <h3>19 · SectionHeader</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Con meta y acción" ancho>
          <SectionHeader titulo="Ruta" meta="01:15:21 · 18.4 km"
                         accion={{ etiqueta: 'Cambiar ruta' }} />
        </Celda>
      </div>

      <h3>20 · MapView + MapControl</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Reposo" ancho nota="El mapa lleva resumen en texto: es invisible para un lector de pantalla.">
          <MapView />
        </Celda>
        <Celda nombre="Cargando" ancho><MapView cargando /></Celda>
        <Celda nombre="MapControl suelto">
          <div style={{ background: '#12161C', padding: 8, borderRadius: 8, display: 'inline-block' }}>
            <MapControl etiqueta="Zoom" controles={[
              { icono: 'mas', titulo: 'Acercar' },
              { icono: 'chevron', titulo: 'Alejar' },
            ]} />
          </div>
        </Celda>
      </div>

      <h3>21 · PhotoStrip + PhotoCard &nbsp;·&nbsp; 22 · ActionTile</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Tira con reportes" ancho><PhotoStrip fotos={FOTOS} /></Celda>
        <Celda nombre="Pidiendo foto" ancho><PhotoStrip fotos={FOTOS} pidiendoFoto /></Celda>
        <Celda nombre="Sin reportes" ancho><PhotoStrip fotos={[]} /></Celda>
        <Celda nombre="PhotoCard suelta"><PhotoCard foto={FOTOS[2]} /></Celda>
        <Celda nombre="ActionTile"><ActionTile /></Celda>
        <Celda nombre="ActionTile deshabilitada"><ActionTile deshabilitado /></Celda>
      </div>

      <h3>23 · RequestList</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Interactiva" ancho nota="Pulsa Aprobar o Rechazar: la fila se resuelve.">
          <RequestList solicitudes={solicitudes}
            onAprobar={id => resolver(id, 'aprobada')}
            onRechazar={id => resolver(id, 'rechazada')} />
        </Celda>
        <Celda nombre="Vacía" ancho><RequestList solicitudes={[]} /></Celda>
      </div>
    </>
  );
}
