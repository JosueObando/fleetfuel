'use client';

import { usePathname, useRouter } from 'next/navigation';
import { BrandBlock } from '@/componentes/BrandBlock/BrandBlock';
import { NavItem } from '@/componentes/NavItem/NavItem';
import { IconToolbar } from '@/componentes/IconToolbar/IconToolbar';
import { PuertaDeSesion } from '@/componentes/PuertaDeSesion/PuertaDeSesion';
import { cerrarSesion } from '@/api/cliente';
import type { NombreIcono } from '@/componentes/Icon/Icon';
import estilos from './ShellApp.module.css';

/*
 * Shell común de la aplicación autenticada. Vive en un solo sitio porque la
 * navegación tiene que ser la misma en catálogos y en operación: dos copias
 * divergirían en cuanto se añada una sección.
 */
const GRUPOS: Array<{ rotulo: string; items: Array<{ ruta: string; etiqueta: string; icono: NombreIcono }> }> = [
  {
    rotulo: 'Operación',
    items: [
      { ruta: '/operacion/ordenes', etiqueta: 'Órdenes', icono: 'ordenes' },
      { ruta: '/operacion/viajes',  etiqueta: 'Viajes',  icono: 'seguimiento' },
      // Va DESPUÉS de viajes porque es lo que pasa después: un viaje se arma
      // en la pantalla de arriba y se despacha, entrega y liquida en ésta.
      { ruta: '/operacion/despacho', etiqueta: 'Despacho y cierre', icono: 'flota' },
      { ruta: '/operacion/informes', etiqueta: 'Informes', icono: 'informes' },
      // Las dos bandejas: lo que espera una decisión de quien opera.
      { ruta: '/operacion/alertas',     etiqueta: 'Alertas',             icono: 'campana' },
      { ruta: '/operacion/solicitudes', etiqueta: 'Solicitudes de ruta', icono: 'seguimiento' },
    ],
  },
  {
    // El trabajo del rol Finanzas (§5): aprobar gastos y liquidaciones de TODOS
    // los viajes de una sentada. Calcular la liquidación sigue en despacho,
    // porque necesita el viaje delante.
    rotulo: 'Finanzas',
    items: [
      { ruta: '/operacion/gastos',        etiqueta: 'Gastos por aprobar', icono: 'ordenes' },
      { ruta: '/operacion/liquidaciones', etiqueta: 'Liquidaciones',      icono: 'informes' },
    ],
  },
  {
    rotulo: 'Catálogos',
    items: [
      { ruta: '/catalogos/clientes',    etiqueta: 'Clientes',    icono: 'conductores' },
      { ruta: '/catalogos/estaciones',  etiqueta: 'Estaciones',  icono: 'seguimiento' },
      { ruta: '/catalogos/productos',   etiqueta: 'Productos',   icono: 'ordenes' },
      { ruta: '/catalogos/vehiculos',   etiqueta: 'Vehículos',   icono: 'flota' },
      { ruta: '/catalogos/cisternas',   etiqueta: 'Cisternas',   icono: 'flota' },
      { ruta: '/catalogos/conductores', etiqueta: 'Conductores', icono: 'conductores' },
    ],
  },
  {
    /* Existe desde el 2026-09-12. La API de usuarios y roles vive en el backend
       desde la Fase 0.3 y NINGUNA pantalla la llamaba: dar de alta a una
       persona exigía entrar por curl, y la compuerta pendiente del plan es
       «producción con usuarios reales». El hueco no estaba en ninguna fase —
       UX-1 entrega catálogos y UX-2 el panel; la administración no era de
       nadie. */
    rotulo: 'Administración',
    items: [
      { ruta: '/administracion/usuarios', etiqueta: 'Usuarios', icono: 'conductores' },
      { ruta: '/administracion/roles',    etiqueta: 'Roles y permisos', icono: 'ajustes' },
      // §21. La auditoría va antes que dispositivos porque es la que se
      // consulta a diario; revocar es una operación de emergencia.
      { ruta: '/administracion/auditoria',    etiqueta: 'Auditoría',    icono: 'informes' },
      { ruta: '/administracion/dispositivos', etiqueta: 'Dispositivos', icono: 'flota' },
    ],
  },
];

export function ShellApp({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const ruta = usePathname();

  /* La puerta ya no vive aquí: es `PuertaDeSesion`, para que también la tengan
     las pantallas que NO llevan esta navegación —`/tablero` tiene su propio
     shell de tres columnas y se quedó sin ella—. Aquí queda lo que sí es de
     este componente: la navegación, que vive en un solo sitio porque dos copias
     divergirían en cuanto se añadiera una sección. */
  return (
    <PuertaDeSesion>
      <div className={estilos.shell}>
        <nav className={estilos.sidebar} aria-label="Navegación principal">
          <div className={estilos.marca}><BrandBlock /></div>

          <div className={estilos.navegacion}>
            {GRUPOS.map(g => (
              <div key={g.rotulo} className={estilos.grupo}>
                {/* El rótulo es un encabezado real, no un span con estilo: así
                    quien navega por encabezados salta entre grupos. */}
                <h2 className={estilos.rotulo}>{g.rotulo}</h2>
                {g.items.map(i => (
                  <NavItem key={i.ruta} icono={i.icono} etiqueta={i.etiqueta}
                           activo={ruta.startsWith(i.ruta)} onClick={() => router.push(i.ruta)} />
                ))}
              </div>
            ))}
          </div>

          <IconToolbar utilidades={[
            { icono: 'campana', titulo: 'Notificaciones' },
            { icono: 'ajustes', titulo: 'Ajustes' },
          ]} />
          {/* `cerrarSesion` y no `guardarSesion(null)`: hay que revocar el
              refresh token en el servidor, o sigue vivo en Redis hasta vencer.
              La navegación va DESPUÉS del await —y el await no puede fallar,
              porque la función limpia la sesión local pase lo que pase—, así
              que no hay camino en el que se salte de pantalla dejando la
              sesión entera en pie. */}
          <NavItem icono="salir" etiqueta="Cerrar sesión"
                   onClick={() => { void cerrarSesion().then(() => router.replace('/entrar')); }} />
        </nav>
        <div className={estilos.contenido}>{children}</div>
      </div>
    </PuertaDeSesion>
  );
}
