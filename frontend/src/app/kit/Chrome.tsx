'use client';

import { BrandBlock } from '@/componentes/BrandBlock/BrandBlock';
import { NavItem } from '@/componentes/NavItem/NavItem';
import { NavGroup } from '@/componentes/NavGroup/NavGroup';
import { IconToolbar } from '@/componentes/IconToolbar/IconToolbar';
import { DashedCTA } from '@/componentes/DashedCTA/DashedCTA';
import estilos from './Chrome.module.css';

/*
 * Los 5 componentes de chrome y navegación con sus 6 estados.
 *
 * Hover, foco y activo-de-puntero no se pueden forzar desde React: son
 * pseudo-clases del navegador. En vez de falsearlos con clases que imiten el
 * aspecto —y que después divergirían del CSS real— se muestra el componente
 * real y se indica el gesto. Así el revisor comprueba el estado auténtico:
 * pasa el ratón, tabula, mantiene pulsado.
 */

function Celda({ nombre, nota, children }: {
  nombre: string; nota?: string; children: React.ReactNode;
}) {
  return (
    <div className={estilos.celda}>
      <div className={estilos.nombreEstado}>{nombre}</div>
      <div className={estilos.lienzoSidebar}>{children}</div>
      {nota && <p className={estilos.nota}>{nota}</p>}
    </div>
  );
}

export function Chrome() {
  const utilidades = [
    { icono: 'campana', titulo: 'Notificaciones' },
    { icono: 'buscar', titulo: 'Buscar' },
    { icono: 'ajustes', titulo: 'Ajustes' },
    { icono: 'ayuda', titulo: 'Ayuda' },
    { icono: 'salir', titulo: 'Cerrar sesión' },
  ] as const;

  return (
    <>
      <h3>1 · BrandBlock</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Reposo"><BrandBlock /></Celda>
        <Celda nombre="Cargando"><BrandBlock cargando /></Celda>
        <Celda nombre="Texto largo" nota="Truncado con elipsis, sin romper el alto de 88 px.">
          <BrandBlock nombre="FleetFuel Control" descriptor="Dirección de Aseo Urbano y Domiciliario" />
        </Celda>
      </div>

      <h3>2 · NavItem</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Reposo"><NavItem icono="seguimiento" etiqueta="Seguimiento" /></Celda>
        <Celda nombre="Hover" nota="Pasa el ratón: fondo blanco 12 %.">
          <NavItem icono="flota" etiqueta="Flota" />
        </Celda>
        <Celda nombre="Foco" nota="Tabula hasta él: anillo blanco, no azul.">
          <NavItem icono="conductores" etiqueta="Conductores" />
        </Celda>
        <Celda nombre="Activo (pulsado)" nota="Mantén pulsado: fondo blanco 20 %.">
          <NavItem icono="ordenes" etiqueta="Órdenes" />
        </Celda>
        <Celda nombre="Seleccionado" nota="Invertido: fondo claro, texto azul. Lleva aria-current.">
          <NavItem icono="seguimiento" etiqueta="Seguimiento" activo />
        </Celda>
        <Celda nombre="Deshabilitado"><NavItem icono="informes" etiqueta="Informes" deshabilitado /></Celda>
        <Celda nombre="Cargando"><NavItem icono="flota" etiqueta="Flota" cargando /></Celda>
      </div>

      <h3>3 · NavGroup</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Cerrado" nota="Pulsa la cabecera: el chevron gira 90°.">
          <NavGroup etiqueta="Solicitudes" badge={4} subitems={[
            { etiqueta: 'Pendientes' }, { etiqueta: 'Aprobadas' }, { etiqueta: 'Rechazadas' },
          ]} />
        </Celda>
        <Celda nombre="Abierto" nota="Guía vertical continua, sin escalones.">
          <NavGroup etiqueta="Solicitudes" badge={4} abiertoInicial subitems={[
            { etiqueta: 'Pendientes', activo: true }, { etiqueta: 'Aprobadas' },
            { etiqueta: 'Rechazadas', deshabilitado: true },
          ]} />
        </Celda>
        <Celda nombre="Deshabilitado">
          <NavGroup etiqueta="Solicitudes" badge={0} deshabilitado subitems={[{ etiqueta: 'Pendientes' }]} />
        </Celda>
        <Celda nombre="Cargando">
          <NavGroup etiqueta="Solicitudes" badge={4} cargando subitems={[{ etiqueta: 'Pendientes' }]} />
        </Celda>
      </div>

      <h3>4 · IconToolbar</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Reposo" nota="Cinco botones sin label: cada uno lleva aria-label.">
          <IconToolbar utilidades={[...utilidades]} />
        </Celda>
        <Celda nombre="Con uno activo">
          <IconToolbar utilidades={utilidades.map((u, i) => ({ ...u, activo: i === 0 }))} />
        </Celda>
        <Celda nombre="Uno deshabilitado">
          <IconToolbar utilidades={utilidades.map((u, i) => ({ ...u, deshabilitado: i === 4 }))} />
        </Celda>
        <Celda nombre="Cargando"><IconToolbar utilidades={[...utilidades]} cargando /></Celda>
      </div>

      <h3>5 · DashedCTA</h3>
      <div className={estilos.rejillaEstados}>
        <Celda nombre="Reposo"><DashedCTA /></Celda>
        <Celda nombre="Hover / pulsado" nota="El FAB baja a scale(.96) al pulsar.">
          <DashedCTA />
        </Celda>
        <Celda nombre="Deshabilitado"><DashedCTA deshabilitado /></Celda>
        <Celda nombre="Cargando"><DashedCTA cargando /></Celda>
      </div>
    </>
  );
}
