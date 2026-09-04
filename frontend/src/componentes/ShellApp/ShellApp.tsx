'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { BrandBlock } from '@/componentes/BrandBlock/BrandBlock';
import { NavItem } from '@/componentes/NavItem/NavItem';
import { IconToolbar } from '@/componentes/IconToolbar/IconToolbar';
import { leerSesion, guardarSesion } from '@/api/cliente';
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
];

export function ShellApp({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const ruta = usePathname();
  const [listo, setListo] = useState(false);

  /* Hasta comprobar la sesión no se pinta nada: si se pintara antes, quien no
     ha entrado vería un instante la aplicación y luego el salto. */
  useEffect(() => {
    if (leerSesion()) setListo(true);
    else router.replace('/entrar');
  }, [router]);

  if (!listo) return <div className={estilos.cargando}>Comprobando la sesión…</div>;

  return (
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
        <NavItem icono="salir" etiqueta="Cerrar sesión"
                 onClick={() => { guardarSesion(null); router.replace('/entrar'); }} />
      </nav>
      <div className={estilos.contenido}>{children}</div>
    </div>
  );
}
