import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tablero } from './Tablero';
import { ENVIOS, SOCIOS, ACTIVOS } from './datos';

const reemplazar = jest.fn();
let consulta = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: reemplazar, push: jest.fn() }),
  usePathname: () => '/tablero',
  useSearchParams: () => consulta,
}));

/*
 * El panel de seguimiento. Su decisión estructural, que el spec pide
 * explícitamente, es que TODO el estado de la vista vive en la URL y no en
 * `useState`: `?partners=a,b&show=active&selected=SD-…`.
 *
 * El efecto de segundo orden es que no hay estado duplicado, la vista es
 * compartible y el botón «atrás» funciona gratis. Si alguien lo «simplificara»
 * a useState, la pantalla se vería idéntica y perdería las tres cosas — por eso
 * lo que se prueba aquí es de dónde SALE el filtro y a dónde VA el cambio.
 */

const conUrl = (qs: string) => { consulta = new URLSearchParams(qs); };
const ultimaUrl = () => String(reemplazar.mock.calls.at(-1)?.[0] ?? '');

beforeEach(() => { jest.clearAllMocks(); conUrl(''); });

describe('el filtro sale de la URL', () => {
  it('sin parámetros se ven todos los envíos', () => {
    render(<Tablero />);
    for (const e of ENVIOS) {
      expect(screen.getByRole('button', { name: new RegExp(e.id) })).toBeInTheDocument();
    }
  });

  it('`partners` deja sólo los de ese socio', () => {
    conUrl('partners=obras');
    render(<Tablero />);
    const deObras = ENVIOS.filter(e => e.socio === 'obras');
    const deOtros = ENVIOS.filter(e => e.socio !== 'obras');
    for (const e of deObras) {
      expect(screen.getByRole('button', { name: new RegExp(e.id) })).toBeInTheDocument();
    }
    for (const e of deOtros) {
      expect(screen.queryByRole('button', { name: new RegExp(e.id) })).not.toBeInTheDocument();
    }
  });

  it('varios socios se suman, no se restan', () => {
    conUrl('partners=obras,parques');
    render(<Tablero />);
    const esperados = ENVIOS.filter(e => ['obras', 'parques'].includes(e.socio));
    for (const e of esperados) {
      expect(screen.getByRole('button', { name: new RegExp(e.id) })).toBeInTheDocument();
    }
  });

  it('`show=activos` esconde los terminados', () => {
    conUrl('show=activos');
    render(<Tablero />);
    const inactivo = ENVIOS.find(e => !ACTIVOS.includes(e.estado));
    expect(inactivo).toBeDefined();
    expect(screen.queryByRole('button', { name: new RegExp(inactivo!.id) })).not.toBeInTheDocument();
  });

  it('`show=inactivos` hace lo contrario', () => {
    conUrl('show=inactivos');
    render(<Tablero />);
    const activo = ENVIOS.find(e => ACTIVOS.includes(e.estado));
    expect(screen.queryByRole('button', { name: new RegExp(activo!.id) })).not.toBeInTheDocument();
  });

  it('los dos filtros se combinan', () => {
    conUrl('partners=aseo&show=activos');
    render(<Tablero />);
    const visibles = ENVIOS.filter(e => e.socio === 'aseo' && ACTIVOS.includes(e.estado));
    const escondido = ENVIOS.find(e => e.socio !== 'aseo');
    expect(visibles.length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: new RegExp(escondido!.id) })).not.toBeInTheDocument();
  });
});

describe('los cambios van A la URL, no a un estado interno', () => {
  it('activar un socio lo añade al parámetro', async () => {
    const usuario = userEvent.setup();
    render(<Tablero />);
    await usuario.click(screen.getByRole('button', { name: new RegExp(SOCIOS[1].etiqueta) }));
    expect(ultimaUrl()).toContain(`partners=${SOCIOS[1].id}`);
  });

  it('desactivarlo lo quita, sin tocar los demás', async () => {
    const usuario = userEvent.setup();
    conUrl('partners=aseo,obras');
    render(<Tablero />);
    await usuario.click(screen.getByRole('button', { name: /Aseo Urbano/ }));
    const url = decodeURIComponent(ultimaUrl());
    expect(url).toContain('partners=obras');
    expect(url).not.toContain('aseo');
  });

  it('quitar el último socio BORRA el parámetro en vez de dejarlo vacío', async () => {
    // `?partners=` sobrando en la URL es basura que se comparte y se pega.
    const usuario = userEvent.setup();
    conUrl('partners=aseo');
    render(<Tablero />);
    await usuario.click(screen.getByRole('button', { name: /Aseo Urbano/ }));
    expect(ultimaUrl()).not.toContain('partners=');
  });

  it('no recarga ni salta al principio de la lista', async () => {
    // `scroll:false`: cambiar de filtro con la lista a media altura no puede
    // devolver a quien mira al principio.
    const usuario = userEvent.setup();
    render(<Tablero />);
    await usuario.click(screen.getByRole('button', { name: /Obras/ }));
    expect(reemplazar.mock.calls.at(-1)?.[1]).toEqual({ scroll: false });
  });

  it('seleccionar un envío queda en la URL, para poder compartir la vista', async () => {
    const usuario = userEvent.setup();
    render(<Tablero />);
    await usuario.click(screen.getByRole('button', { name: new RegExp(ENVIOS[0].id) }));
    expect(decodeURIComponent(ultimaUrl())).toContain(`selected=${ENVIOS[0].id}`);
  });
});

describe('los datos del panel son coherentes', () => {
  it('cada envío pertenece a un socio que existe', () => {
    // Un socio huérfano deja un envío que ningún filtro puede mostrar.
    const ids = new Set(SOCIOS.map(s => s.id));
    for (const e of ENVIOS) expect({ id: e.id, socio: ids.has(e.socio) }).toEqual({ id: e.id, socio: true });
  });

  it('cada ruta tiene exactamente UNA parada actual, o ninguna si terminó', () => {
    for (const e of ENVIOS) {
      const actuales = e.paradas.filter(p => p.fase === 'actual').length;
      expect({ id: e.id, actuales: actuales <= 1 }).toEqual({ id: e.id, actuales: true });
    }
  });

  it('lo entregado no cuenta como activo', () => {
    expect(ACTIVOS).not.toContain('entregado');
  });

  it('los identificadores no se repiten', () => {
    expect(new Set(ENVIOS.map(e => e.id)).size).toBe(ENVIOS.length);
  });
});

describe('es un boceto, y tiene que decirlo', () => {
  /*
   * Esta pantalla es el boceto de UX-2: los seis envíos salen de `./datos`, no
   * de la API, y no habrá datos reales hasta que cierre 2B (telemetría). Eso
   * era invisible para quien la miraba — y hasta el 2026-09-12 era además la
   * PRIMERA pantalla del dominio, servida sin sesión.
   *
   * El plan pide que lo diferido se marque como diferido y no se deje dibujado
   * como si funcionara. Un panel de operaciones con seis camiones inventados no
   * es una pantalla vacía: es una pantalla que MIENTE, y lo hace con el aplomo
   * de un dato real. El aviso es la diferencia entre un boceto y un engaño.
   */
  it('avisa de que los datos son de muestra', () => {
    render(<Tablero />);
    /* `note` y no `status`: el aviso está siempre ahí, no es un mensaje que
       aparece. Un `role="status"` es una región viva y el lector de pantalla
       lo anunciaría en cada render, interrumpiendo lo que se estuviera
       leyendo, para decir algo que no ha cambiado. */
    expect(screen.getByRole('note', { name: /boceto/i })).toBeInTheDocument();
  });

  it('y dice de qué depende para traer datos de verdad', () => {
    // Sin el porqué, el aviso se lee como un fallo temporal y alguien abre un
    // defecto. Con él, se lee como lo que es: trabajo que todavía no toca.
    render(<Tablero />);
    expect(screen.getByRole('note', { name: /boceto/i }))
      .toHaveTextContent(/UX-2/);
  });
});
