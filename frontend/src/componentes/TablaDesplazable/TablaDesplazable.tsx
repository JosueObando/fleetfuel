import estilos from './TablaDesplazable.module.css';

/**
 * Envuelve una tabla para que scrollee ELLA y no la página.
 *
 * Una tabla no se puede estrechar sin volverse ilegible —una celda de «Vence la
 * licencia» no cabe en 360 px por mucho que se aprieten las columnas—, así que
 * es la única excepción a la regla de que el cuerpo nunca se desplaza en
 * horizontal. Sin esto, una tabla ancha arrastra la página entera y el menú, el
 * título y los botones se salen con ella.
 *
 * `tabIndex={0}` NO es opcional. Un contenedor que scrollea y no puede recibir
 * el foco sólo se desplaza con un ratón: quien navega con teclado pierde las
 * columnas de la derecha por completo. Y como el elemento pasa a ser
 * enfocable, necesita nombre — de ahí `role="region"` con su etiqueta.
 */
export function TablaDesplazable({ etiqueta, children }: {
  etiqueta: string; children: React.ReactNode;
}) {
  return (
    <div className={estilos.caja} role="region" aria-label={etiqueta} tabIndex={0}>
      {children}
    </div>
  );
}
