import estilos from './page.module.css';
import { Chrome } from './Chrome';
import { Tracking } from './Tracking';
import { Detalle } from './Detalle';

/*
 * Kit del sistema de diseño. Es el «equivalente a Storybook» del plan: una
 * ruta de la propia aplicación, que no añade una segunda cadena de build ni
 * un runtime aparte que pueda divergir de cómo se ve la app de verdad.
 *
 * Hoy muestra los tokens. Va creciendo hasta los 24 componentes × 6 estados
 * que exige el criterio de salida de UX-0.
 */

const COLORES: Array<[string, string, string]> = [
  ['--bg-base', '#F4F6F7', 'Lienzo'],
  ['--bg-surface', '#FCFDFD', 'Paneles y tarjetas'],
  ['--bg-inverse', '#0660FF', 'Sidebar (azul, no oscuro)'],
  ['--action-subtle', '#EDF7FF', 'Botón secundario'],
  ['--action', '#0660FF', 'Acción y selección'],
  ['--fg-strong', '#21252B', 'Títulos'],
  ['--fg-default', '#363B43', 'Cuerpo'],
  ['--fg-muted', '#5E6F80', 'Captions'],
  ['--border-subtle', '#D9D9D9', 'Divisores'],
  ['--color-success-500', '#2ECC71', 'En ruta'],
  ['--color-warning-500', '#F59E0B', 'Esperando'],
  ['--color-error-500', '#E53935', 'Retrasado'],
];

const TIPOS: Array<[string, string, string]> = [
  ['display', '24/28', 'Seguimiento'],
  ['titulo', '22/26', 'SD-4821-PTY'],
  ['lg', '15/20', 'Cisterna 04 · Juan Pérez'],
  ['md', '13/16', 'Filtrar por socios'],
  ['sm', '12/16', 'Llamar al conductor'],
  ['xs', '11/14', 'Actualizado hace 2 min'],
  ['2xs', '10.5/13', 'Vía España, San Francisco'],
  ['3xs', '10/13', '14:32'],
];

export default function Kit() {
  return (
    <main className={estilos.pagina}>
      <div className={estilos.contenedor}>
        <h1 className={estilos.titulo}>Kit · FleetFuel Control</h1>
        <p className={estilos.subtitulo}>
          Sistema de diseño de la fase UX-0. Tema claro del spec.
        </p>

        <section className={estilos.seccion}>
          <h2 className={estilos.seccionTitulo}>Color</h2>
          <div className={estilos.rejilla}>
            {COLORES.map(([token, hex, uso]) => (
              <div key={token} className={estilos.muestra}>
                <div className={estilos.muestraColor} style={{ background: `var(${token})` }} />
                <div className={estilos.muestraPie}>
                  <div className={estilos.muestraNombre}>{token}</div>
                  <div className={estilos.muestraValor}>{hex} · {uso}</div>
                </div>
              </div>
            ))}
          </div>
          <p className={estilos.aviso}>
            <strong>Corrección documentada:</strong> <code>--fg-muted</code> es{' '}
            <code>#5E6F80</code> y no el <code>#627485</code> del spec. Ese valor
            daba 4.45:1 sobre el lienzo y no alcanzaba AA. El actual da 4.77:1.
            Verificado por <code>npm run auditar:contraste</code>.
          </p>
        </section>

        <section className={estilos.seccion}>
          <h2 className={estilos.seccionTitulo}>Tipografía</h2>
          {TIPOS.map(([nombre, medida, ejemplo]) => (
            <div key={nombre} className={estilos.filaTipo}>
              <span className={estilos.etiquetaTipo}>{nombre} · {medida}</span>
              <span
                style={{
                  fontSize: `var(--texto-${nombre})`,
                  lineHeight: `var(--interlineado-${nombre})`,
                  fontFamily: nombre === 'display' || nombre === 'titulo'
                    ? 'var(--fuente-titulo)' : 'var(--fuente-cuerpo)',
                  fontWeight: nombre === 'display' || nombre === 'titulo'
                    ? 'var(--peso-fuerte)' : 'var(--peso-normal)',
                  color: 'var(--fg-strong)',
                }}
              >
                {ejemplo}
              </span>
            </div>
          ))}
          <p className={estilos.aviso}>
            Los dos primeros deberían ir en <strong>Noka</strong>. Es una tipografía
            comercial y no está en el repositorio, así que hoy caen en Montserrat.
            Faltan los <code>.woff2</code> de la marca.
          </p>
        </section>

        <section className={estilos.seccion}>
          <h2 className={estilos.seccionTitulo}>
            Chrome y navegación · 5 de 24
          </h2>
          <Chrome />
        </section>

        <section className={estilos.seccion}>
          <h2 className={estilos.seccionTitulo}>
            Panel de tracking · 8 de 24
          </h2>
          <Tracking />
        </section>

        <section className={estilos.seccion}>
          <h2 className={estilos.seccionTitulo}>
            Panel de detalle · 11 de 24
          </h2>
          <Detalle />
        </section>

        <section className={estilos.seccion}>
          <h2 className={estilos.seccionTitulo}>Forma</h2>
          <div className={estilos.formas}>
            <div className={estilos.forma} style={{ borderRadius: 'var(--radius-sm)' }}>sm · 8</div>
            <div className={estilos.forma} style={{ borderRadius: 'var(--radius-md)' }}>md · 12</div>
            <div className={estilos.forma} style={{ borderRadius: 'var(--radius-card)' }}>card · 16</div>
            <div className={estilos.forma} style={{ borderRadius: 'var(--radius-pill)' }}>pill</div>
          </div>
          <p className={estilos.aviso}>
            Los botones del spec son <strong>pastilla</strong>, no radio 8. Es la
            diferencia más citada del spec frente al original.
          </p>
        </section>
      </div>
    </main>
  );
}
