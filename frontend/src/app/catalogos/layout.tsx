'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { BrandBlock } from '@/componentes/BrandBlock/BrandBlock';
import { NavItem } from '@/componentes/NavItem/NavItem';
import { IconToolbar } from '@/componentes/IconToolbar/IconToolbar';
import { leerSesion, guardarSesion } from '@/api/cliente';
import type { NombreIcono } from '@/componentes/Icon/Icon';
import estilos from './layout.module.css';

const SECCIONES: Array<{ ruta: string; etiqueta: string; icono: NombreIcono }> = [
  { ruta: '/catalogos/clientes',    etiqueta: 'Clientes',    icono: 'conductores' },
  { ruta: '/catalogos/estaciones',  etiqueta: 'Estaciones',  icono: 'seguimiento' },
  { ruta: '/catalogos/productos',   etiqueta: 'Productos',   icono: 'ordenes' },
  { ruta: '/catalogos/vehiculos',   etiqueta: 'Vehículos',   icono: 'flota' },
  { ruta: '/catalogos/cisternas',   etiqueta: 'Cisternas',   icono: 'flota' },
  { ruta: '/catalogos/conductores', etiqueta: 'Conductores', icono: 'conductores' },
];

export default function LayoutCatalogos({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const ruta = usePathname();
  const [listo, setListo] = useState(false);

  /* La guarda corre en el cliente porque la sesión vive en localStorage, que
     el servidor no ve. Hasta que se comprueba NO se pinta la aplicación: si se
     pintara primero, alguien sin sesión vería la interfaz un instante y luego
     el salto a la pantalla de entrada. */
  useEffect(() => {
    if (leerSesion()) setListo(true);
    else router.replace('/entrar');
  }, [router]);

  if (!listo) return <div className={estilos.cargando}>Comprobando la sesión…</div>;

  return (
    <div className={estilos.shell}>
      <nav className={estilos.sidebar} aria-label="Catálogos">
        <div className={estilos.marca}><BrandBlock /></div>
        <div className={estilos.navegacion}>
          {SECCIONES.map(s => (
            <NavItem
              key={s.ruta}
              icono={s.icono}
              etiqueta={s.etiqueta}
              activo={ruta === s.ruta}
              onClick={() => router.push(s.ruta)}
            />
          ))}
        </div>
        <IconToolbar utilidades={[
          { icono: 'seguimiento', titulo: 'Ir al tablero' },
          { icono: 'ajustes', titulo: 'Ajustes' },
          { icono: 'salir', titulo: 'Cerrar sesión' },
        ]} />
        {/* El cierre de sesión va aparte: IconToolbar no lleva acciones, y
            atarle una sería cambiar su contrato por un caso. */}
        <button
          type="button"
          className="solo-lectores"
          onClick={() => { guardarSesion(null); router.replace('/entrar'); }}
        >
          Cerrar sesión
        </button>
      </nav>
      <div className={estilos.contenido}>{children}</div>
    </div>
  );
}
