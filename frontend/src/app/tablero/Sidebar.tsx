'use client';

import { BrandBlock } from '@/componentes/BrandBlock/BrandBlock';
import { NavItem } from '@/componentes/NavItem/NavItem';
import { NavGroup } from '@/componentes/NavGroup/NavGroup';
import { IconToolbar } from '@/componentes/IconToolbar/IconToolbar';
import { DashedCTA } from '@/componentes/DashedCTA/DashedCTA';
import estilos from './tablero.module.css';

/*
 * El sidebar se colapsa a 72 px por CSS (1024-1279), no por JavaScript. Con
 * JS habría que medir la ventana, escuchar el resize y sincronizar estado —y
 * el primer pintado saldría con el ancho equivocado. Una media query no
 * tiene ninguno de esos problemas.
 *
 * `colapsado` aquí es solo para la demostración del kit, donde no se puede
 * cambiar el ancho real de la ventana.
 */
export function Sidebar({ colapsado }: { colapsado?: boolean }) {
  return (
    <nav className={estilos.sidebar} aria-label="Navegación principal">
      {/* Dos instancias y no una con clase condicional: cuál se ve lo decide
          la media query, sin que el componente tenga que saber el ancho. */}
      <div className={estilos.marcaCompleta}><BrandBlock /></div>
      <div className={estilos.marcaColapsada}><BrandBlock soloMarca /></div>

      <div className={estilos.navegacion}>
        <NavItem icono="seguimiento" etiqueta="Seguimiento" activo colapsado={colapsado} />
        <NavItem icono="flota"       etiqueta="Flota"        colapsado={colapsado} />
        <NavItem icono="conductores" etiqueta="Conductores"  colapsado={colapsado} />
        <NavItem icono="ordenes"     etiqueta="Órdenes"      colapsado={colapsado} />
        {!colapsado && (
          <NavGroup etiqueta="Solicitudes" badge={2} subitems={[
            { etiqueta: 'Pendientes' },
            { etiqueta: 'Aprobadas' },
            { etiqueta: 'Rechazadas' },
          ]} />
        )}
        <NavItem icono="informes" etiqueta="Informes" colapsado={colapsado} />
      </div>

      <div className={estilos.pieSidebar}>
        {!colapsado && <DashedCTA />}
        <IconToolbar utilidades={[
          { icono: 'campana', titulo: 'Notificaciones' },
          { icono: 'buscar',  titulo: 'Buscar' },
          { icono: 'ajustes', titulo: 'Ajustes' },
          { icono: 'ayuda',   titulo: 'Ayuda' },
          { icono: 'salir',   titulo: 'Cerrar sesión' },
        ]} />
      </div>
    </nav>
  );
}
