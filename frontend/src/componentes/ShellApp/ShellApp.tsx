'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from '@/componentes/Icon/Icon';
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
      // §15.3: la semana por cisterna. Junto a viajes, porque es donde se
      // decide a qué cisterna y conductor va cada uno antes de autorizar.
      { ruta: '/operacion/planificador', etiqueta: 'Planificador', icono: 'calendario' },
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

/* <768: la barra inferior del spec (§7) lleva CINCO destinos. Cuatro accesos
   —los de quien opera en la calle: la cola de órdenes, los viajes, el despacho
   y las alertas— y «Más», que abre el menú entero. El resto de secciones no
   desaparece: está a un toque. */
const ACCESOS: Array<{ ruta: string; etiqueta: string; icono: NombreIcono }> = [
  { ruta: '/operacion/ordenes',  etiqueta: 'Órdenes',  icono: 'ordenes' },
  { ruta: '/operacion/viajes',   etiqueta: 'Viajes',   icono: 'seguimiento' },
  { ruta: '/operacion/despacho', etiqueta: 'Despacho', icono: 'flota' },
  { ruta: '/operacion/alertas',  etiqueta: 'Alertas',  icono: 'campana' },
];

export function ShellApp({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const ruta = usePathname();
  const idNav = useId();

  /* Qué se VE a cada ancho lo deciden las media queries de ShellApp.module.css
     —menú lateral, colapsado, cajón o barra inferior—, no JavaScript: medir la
     ventana haría que el primer pintado saliera con el ancho equivocado. Aquí
     sólo vive lo que CSS no puede tener: si el cajón está abierto, y el foco. */
  const [abierto, setAbierto] = useState(false);
  const abridor = useRef<HTMLButtonElement | null>(null);
  const cerrarBoton = useRef<HTMLButtonElement | null>(null);

  const abrir = (e: React.MouseEvent<HTMLButtonElement>) => {
    abridor.current = e.currentTarget;
    setAbierto(true);
  };
  const cerrar = () => {
    setAbierto(false);
    abridor.current?.focus();
  };
  const ir = (destino: string) => {
    setAbierto(false);
    router.push(destino);
  };

  /* El foco entra DESPUÉS de pintar abierto: antes, el botón está en
     `visibility: hidden` y el navegador ignora el `focus()`. */
  useEffect(() => { if (abierto) cerrarBoton.current?.focus(); }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [abierto]);

  /* A ≥1024 la navegación vuelve a ser el menú lateral: un cajón «abierto»
     dejaría la pantalla inerte sin nada visible que cerrar. */
  useEffect(() => {
    const amplio = window.matchMedia?.('(min-width: 1024px)');
    if (!amplio) return;
    const alCambiar = (e: { matches: boolean }) => { if (e.matches) setAbierto(false); };
    amplio.addEventListener('change', alCambiar);
    return () => amplio.removeEventListener('change', alCambiar);
  }, []);

  /* La puerta ya no vive aquí: es `PuertaDeSesion`, para que también la tengan
     las pantallas que NO llevan esta navegación —`/tablero` tiene su propio
     shell de tres columnas y se quedó sin ella—. Aquí queda lo que sí es de
     este componente: la navegación, que vive en un solo sitio porque dos copias
     divergirían en cuanto se añadiera una sección. */
  return (
    <PuertaDeSesion>
      <div className={`${estilos.shell} ${abierto ? estilos.abierto : ''}`}>
        {/* 768–1023: la marca y el botón del cajón, en una cabecera. */}
        <header className={estilos.cabeceraCompacta}>
          <BrandBlock />
          <button type="button" className={estilos.botonMenu} onClick={abrir}
                  aria-label="Abrir el menú" aria-expanded={abierto} aria-controls={idNav}>
            <Icon nombre="menu" tamano={20} />
            <span>Menú</span>
          </button>
        </header>

        <nav id={idNav} className={estilos.sidebar} aria-label="Navegación principal">
          <div className={estilos.cabeceraCajon}>
            <div className={estilos.marca}><BrandBlock /></div>
            <div className={estilos.marcaColapsada}><BrandBlock soloMarca /></div>
            <button type="button" ref={cerrarBoton} className={estilos.botonCerrar}
                    onClick={cerrar} aria-label="Cerrar el menú">
              <Icon nombre="cerrar" tamano={20} />
            </button>
          </div>

          <div className={estilos.navegacion}>
            {GRUPOS.map(g => (
              <div key={g.rotulo} className={estilos.grupo}>
                {/* El rótulo es un encabezado real, no un span con estilo: así
                    quien navega por encabezados salta entre grupos. */}
                <h2 className={estilos.rotulo}>{g.rotulo}</h2>
                {g.items.map(i => (
                  <NavItem key={i.ruta} icono={i.icono} etiqueta={i.etiqueta} colapsable
                           activo={ruta.startsWith(i.ruta)} onClick={() => ir(i.ruta)} />
                ))}
              </div>
            ))}
          </div>

          <div className={estilos.utilidades}>
            <IconToolbar utilidades={[
              { icono: 'campana', titulo: 'Notificaciones' },
              { icono: 'ajustes', titulo: 'Ajustes' },
            ]} />
          </div>
          {/* `cerrarSesion` y no `guardarSesion(null)`: hay que revocar el
              refresh token en el servidor, o sigue vivo en Redis hasta vencer.
              La navegación va DESPUÉS del await —y el await no puede fallar,
              porque la función limpia la sesión local pase lo que pase—, así
              que no hay camino en el que se salte de pantalla dejando la
              sesión entera en pie. */}
          <NavItem icono="salir" etiqueta="Cerrar sesión" colapsable
                   onClick={() => { void cerrarSesion().then(() => router.replace('/entrar')); }} />
        </nav>

        {/* Atajo de ratón y dedo, no un control: quien usa teclado cierra con
            Escape o con «Cerrar el menú». */}
        <div className={estilos.telon} data-telon onClick={cerrar} aria-hidden />

        {/* Con el cajón abierto, lo de detrás no se ve: tampoco se tabula. */}
        <div className={estilos.contenido} inert={abierto}>{children}</div>

        <nav className={estilos.barraInferior} aria-label="Accesos rápidos">
          {ACCESOS.map(a => (
            <button key={a.ruta} type="button" onClick={() => ir(a.ruta)}
                    className={estilos.acceso}
                    aria-current={ruta.startsWith(a.ruta) ? 'page' : undefined}>
              <Icon nombre={a.icono} tamano={20} />
              <span>{a.etiqueta}</span>
            </button>
          ))}
          <button type="button" className={estilos.acceso} onClick={abrir}
                  aria-expanded={abierto} aria-controls={idNav}>
            <Icon nombre="menu" tamano={20} />
            <span>Más</span>
          </button>
        </nav>
      </div>
    </PuertaDeSesion>
  );
}
