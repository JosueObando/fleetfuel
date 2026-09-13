import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Informes } from './Informes';
import { ErrorApi } from '@/api/cliente';

const reemplazar = jest.fn();
let consulta = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: reemplazar, push: jest.fn() }),
  usePathname: () => '/operacion/informes',
  useSearchParams: () => consulta,
}));

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { listar: jest.fn(), obtener: jest.fn(), crear: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as {
  api: Record<'listar' | 'obtener' | 'crear', jest.Mock>;
};

/*
 * Los cuatro informes del §14 que la Fase 1C construyó en el backend y que
 * hasta el 2026-09-12 no tenían pantalla.
 *
 * LO QUE MÁS IMPORTA DE ESTE FICHERO
 *
 * Que el informe de volumen NO se limite a enseñar cuatro sumas. Existe para
 * hacer visible el descuadre que el §7 llama el riesgo principal de este
 * negocio, y cuatro números en fila dejan esa resta a cargo de quien mira.
 * La pantalla la hace y la nombra.
 *
 * El estado vive en la URL, como en el tablero: un informe filtrado es algo que
 * se manda por mensaje, y sin URL habría que explicar cómo llegar a él.
 */

const OPERATIVO = {
  viajesProgramados: 4, cisternasEnRuta: 2, cisternasDisponibles: 3,
  ordenesPendientes: 7, ordenesEntregadas: 12, entregasParciales: 1,
  viajesRetrasados: 2,
};

const VOLUMEN = {
  volumenSolicitado: '10000.00', volumenPlanificado: '9800.00',
  volumenEntregado: '9500.00', volumenPendiente: '500.00',
};

const MERMAS = [
  { grupo: 'Ana Pérez', entregas: 12, volumenCargado: '30000.00',
    volumenRecibido: '29850.00', diferenciaTotal: '150.00',
    mermaPorcentaje: '0.5000', pendientesDeAprobar: 2 },
  { grupo: 'Luis Gómez', entregas: 8, volumenCargado: '20000.00',
    volumenRecibido: '19990.00', diferenciaTotal: '10.00',
    mermaPorcentaje: '0.0500', pendientesDeAprobar: 0 },
];

const RECORRIDOS = [
  { id: '1', codigoViaje: 'V-001', conductor: 'Ana Pérez',
    odometroInicial: '1000.00', odometroFinal: '1250.00', kilometros: '250.00',
    kilometrosGps: '262.00', fechaInicio: '2026-09-01T06:00:00Z',
    fechaFin: '2026-09-01T14:30:00Z', duracionSegundos: '30600' },
];

function conApi(over: Record<string, unknown> = {}) {
  api.obtener.mockImplementation((r: string) => {
    if (r.startsWith('/informes/operativo')) return Promise.resolve(over.operativo ?? OPERATIVO);
    if (r.startsWith('/informes/volumen')) return Promise.resolve(over.volumen ?? VOLUMEN);
    return Promise.resolve({});
  });
  api.listar.mockImplementation((r: string) => {
    if (r.startsWith('/informes/mermas')) return Promise.resolve(over.mermas ?? MERMAS);
    if (r.startsWith('/informes/recorridos')) return Promise.resolve(over.recorridos ?? RECORRIDOS);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  consulta = new URLSearchParams();
  conApi();
});

/* ─────────────────────────────────────────────────────────────────────────
 * Qué informe se ve, y que eso viva en la URL
 * ───────────────────────────────────────────────────────────────────────── */
describe('la elección del informe vive en la URL', () => {
  it('sin nada en la URL abre el operativo del §14.1', async () => {
    render(<Informes />);
    await waitFor(() => expect(api.obtener).toHaveBeenCalledWith('/informes/operativo'));
    expect(await screen.findByText(/Viajes programados/i)).toBeInTheDocument();
  });

  it('con `?informe=mermas` abre las mermas directamente', async () => {
    // Es lo que hace que un informe se pueda mandar por mensaje.
    consulta = new URLSearchParams('informe=mermas');
    render(<Informes />);
    await waitFor(() =>
      expect(api.listar).toHaveBeenCalledWith('/informes/mermas?agruparPor=conductor'));
  });

  it('cambiar de informe lo escribe en la URL', async () => {
    const usuario = userEvent.setup();
    render(<Informes />);
    await usuario.click(await screen.findByRole('tab', { name: /Recorridos/i }));
    await waitFor(() => expect(reemplazar).toHaveBeenCalledWith(
      expect.stringContaining('informe=recorridos'), { scroll: false }));
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * §14.1 · La foto operativa
 * ───────────────────────────────────────────────────────────────────────── */
describe('§14.1 · operativo', () => {
  it('enseña los siete indicadores del día', async () => {
    render(<Informes />);
    for (const r of ['Viajes programados', 'Cisternas en ruta', 'Cisternas disponibles',
                     'Órdenes pendientes', 'Órdenes entregadas', 'Entregas parciales',
                     'Viajes retrasados']) {
      expect(await screen.findByText(r)).toBeInTheDocument();
    }
  });

  /* Los filtros se prueban en DOS mitades, y no en una, porque la URL es la
     única fuente: la pantalla no guarda la fecha en un estado propio, la
     escribe en la dirección y vuelve a leerla de allí. Con el router doblado la
     dirección no cambia sola, así que probar «escribo y llega la petición» en
     un solo caso sólo demostraría que el doble no navega. */
  it('elegir fecha la escribe en la URL', async () => {
    const usuario = userEvent.setup();
    render(<Informes />);
    await usuario.type(await screen.findByLabelText(/Día/i), '2026-09-01');
    await waitFor(() => expect(reemplazar).toHaveBeenCalledWith(
      expect.stringContaining('fecha=2026-09-01'), { scroll: false }));
  });

  it('y con la fecha ya en la URL, la petición la lleva', async () => {
    consulta = new URLSearchParams('fecha=2026-09-01');
    render(<Informes />);
    await waitFor(() =>
      expect(api.obtener).toHaveBeenCalledWith('/informes/operativo?fecha=2026-09-01'));
  });

  it('los viajes retrasados se destacan cuando los hay', async () => {
    // Un cero y un dos no pueden verse igual: el informe existe para que un
    // retraso salte, no para que haya que buscarlo entre siete casillas.
    render(<Informes />);
    const retrasados = (await screen.findByText('Viajes retrasados')).closest('div')!;
    expect(within(retrasados).getByText('2')).toBeInTheDocument();
    expect(within(retrasados).getByText(/requieren atención/i)).toBeInTheDocument();
  });

  it('sin retrasos lo dice en positivo', async () => {
    conApi({ operativo: { ...OPERATIVO, viajesRetrasados: 0 } });
    render(<Informes />);
    const retrasados = (await screen.findByText('Viajes retrasados')).closest('div')!;
    expect(within(retrasados).getByText(/ninguno fuera de hora/i)).toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * §14.2 · La cadena del volumen — el corazón de la pantalla
 * ───────────────────────────────────────────────────────────────────────── */
describe('§14.2 · la cadena del volumen hace visible el descuadre', () => {
  it('enseña los cuatro eslabones', async () => {
    consulta = new URLSearchParams('informe=volumen');
    render(<Informes />);
    for (const r of ['Solicitado', 'Planificado', 'Entregado', 'Pendiente']) {
      expect(await screen.findByText(r)).toBeInTheDocument();
    }
  });

  it('CALCULA la diferencia entre lo planificado y lo entregado, y la nombra', async () => {
    // 9 800 planificados contra 9 500 entregados son 300 que no llegaron. Si la
    // pantalla se limitara a poner los dos números en fila, esa resta la haría
    // quien mira — y es justo la que no debería depender de que alguien la
    // haga.
    consulta = new URLSearchParams('informe=volumen');
    render(<Informes />);
    const bloque = (await screen.findByText(/Sin entregar/i)).closest('div')!;
    expect(within(bloque).getByText('300')).toBeInTheDocument();
  });

  it('cuando la cadena cuadra, lo dice', async () => {
    consulta = new URLSearchParams('informe=volumen');
    conApi({ volumen: { volumenSolicitado: '1000.00', volumenPlanificado: '1000.00',
                        volumenEntregado: '1000.00', volumenPendiente: '0.00' } });
    render(<Informes />);
    expect(await screen.findByText(/la cadena cuadra/i)).toBeInTheDocument();
  });

  it('el rango de fechas se escribe en la URL', async () => {
    const usuario = userEvent.setup();
    consulta = new URLSearchParams('informe=volumen');
    render(<Informes />);
    await usuario.type(await screen.findByLabelText(/Desde/i), '2026-09-01');
    await waitFor(() => expect(reemplazar).toHaveBeenCalledWith(
      expect.stringContaining('desde=2026-09-01'), { scroll: false }));
  });

  it('y con el rango ya en la URL, la petición lo lleva entero', async () => {
    consulta = new URLSearchParams('informe=volumen&desde=2026-09-01&hasta=2026-09-30');
    render(<Informes />);
    await waitFor(() => expect(api.obtener).toHaveBeenCalledWith(
      '/informes/volumen?desde=2026-09-01&hasta=2026-09-30'));
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * §14.2 · Mermas
 * ───────────────────────────────────────────────────────────────────────── */
describe('§14.2 · mermas', () => {
  it('agrupa por conductor por omisión y lista de mayor a menor descuadre', async () => {
    consulta = new URLSearchParams('informe=mermas');
    render(<Informes />);
    const filas = await screen.findAllByRole('row');
    // La cabecera es la primera; Ana (150) va antes que Luis (10).
    expect(filas[1]).toHaveTextContent('Ana Pérez');
    expect(filas[2]).toHaveTextContent('Luis Gómez');
  });

  it('cambiar la agrupación la escribe en la URL', async () => {
    const usuario = userEvent.setup();
    consulta = new URLSearchParams('informe=mermas');
    render(<Informes />);
    await usuario.click(await screen.findByRole('radio', { name: /cisterna/i }));
    await waitFor(() => expect(reemplazar).toHaveBeenCalledWith(
      expect.stringContaining('agruparPor=cisterna'), { scroll: false }));
  });

  it('y con la agrupación ya en la URL, se pide agrupado por eso', async () => {
    consulta = new URLSearchParams('informe=mermas&agruparPor=producto');
    render(<Informes />);
    await waitFor(() =>
      expect(api.listar).toHaveBeenCalledWith('/informes/mermas?agruparPor=producto'));
  });

  it('señala las entregas que siguen sin aprobar', async () => {
    // Una merma grande ya resuelta y otra sin mirar no son el mismo problema.
    consulta = new URLSearchParams('informe=mermas');
    render(<Informes />);
    const fila = (await screen.findAllByRole('row'))[1];
    expect(within(fila).getByText(/2 sin aprobar/i)).toBeInTheDocument();
  });

  it('sin entregas todavía, lo dice', async () => {
    consulta = new URLSearchParams('informe=mermas');
    conApi({ mermas: [] });
    render(<Informes />);
    expect(await screen.findByText(/Todavía no hay entregas/i)).toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * §14.1 · Recorridos
 * ───────────────────────────────────────────────────────────────────────── */
describe('§14.1 · recorridos', () => {
  it('enfrenta el odómetro con el GPS, que es lo que el §10.1 pide comparar', async () => {
    // 250 por odómetro contra 262 por GPS. La diferencia es la señal: un
    // odómetro que se queda corto de forma sistemática es un dato manipulable,
    // y el GPS es el que no se puede escribir a mano.
    consulta = new URLSearchParams('informe=recorridos');
    render(<Informes />);
    const fila = (await screen.findAllByRole('row'))[1];
    expect(within(fila).getByText('250')).toBeInTheDocument();
    expect(within(fila).getByText('262')).toBeInTheDocument();
    expect(within(fila).getByText('12')).toBeInTheDocument();
  });

  it('la duración se lee en horas y minutos, no en segundos', async () => {
    consulta = new URLSearchParams('informe=recorridos');
    render(<Informes />);
    expect(await screen.findByText('8 h 30 min')).toBeInTheDocument();
  });

  it('sin viajes cerrados, lo dice', async () => {
    consulta = new URLSearchParams('informe=recorridos');
    conApi({ recorridos: [] });
    render(<Informes />);
    expect(await screen.findByText(/Ningún viaje cerrado/i)).toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Errores
 * ───────────────────────────────────────────────────────────────────────── */
describe('los errores se cuentan', () => {
  it('un 403 sin el permiso `informes:leer` aparece en pantalla', async () => {
    api.obtener.mockRejectedValue(new ErrorApi(403, 'No tienes el permiso informes:leer'));
    render(<Informes />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/informes:leer/);
  });
});
