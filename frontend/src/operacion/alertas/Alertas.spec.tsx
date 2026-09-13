import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Alertas } from './Alertas';
import { ErrorApi } from '@/api/cliente';

const reemplazar = jest.fn();
let consulta = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: reemplazar, push: jest.fn() }),
  usePathname: () => '/operacion/alertas',
  useSearchParams: () => consulta,
}));

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { listar: jest.fn(), crear: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as {
  api: Record<'listar' | 'crear', jest.Mock>;
};

/*
 * §22 · La bandeja de alertas.
 *
 * El backend las detecta, las deduplica y las ordena por gravedad desde el
 * 2026-09-07, y hasta hoy no había forma de verlas sin curl: un sistema de
 * alertas que nadie lee no alerta de nada.
 *
 * LO QUE MÁS IMPORTA DE ESTE FICHERO
 *
 * Que cerrar una alerta deje dicho POR QUÉ. Una alerta de «sello inconsistente»
 * que desaparece sin motivo es exactamente el rastro que un fraude de volumen
 * querría dejar. Y que «reconocer» y «resolver» no se confundan: reconocer es
 * «la he visto y me encargo», resolver es «ya no hay problema». Si fueran el
 * mismo botón, lo visto pasaría por arreglado.
 */

const ALERTAS = [
  { id: 'a1', tipo: 'sello_inconsistente', severidad: 'critica', estado: 'abierta',
    titulo: 'Sello inconsistente en V-001',
    // `alertas.detalle` es JSONB: llega como OBJETO. La primera versión de este
    // fichero lo simulaba como texto —una suposición, no el contrato— y la
    // pantalla habría pintado «[object Object]» en producción con todo verde.
    detalle: { estadoSello: 'inconsistente', sello: 'SELLO-78' },
    detectadaEn: '2026-09-13T08:15:00Z', viajeId: '1' },
  { id: 'a2', tipo: 'perdida_gps', severidad: 'media', estado: 'reconocida',
    titulo: 'Sin GPS en V-002', detalle: { ultima: '2026-09-13T12:28:00Z', silencioSegundos: 1320 },
    detectadaEn: '2026-09-13T07:50:00Z', reconocidaEn: '2026-09-13T08:00:00Z', viajeId: '2' },
];

const RESUELTA = {
  id: 'a3', tipo: 'gasto_sin_comprobante', severidad: 'baja', estado: 'resuelta',
  titulo: 'Gasto sin comprobante', detalle: { monto: '18.75', categoria: 'peaje' },
  detectadaEn: '2026-09-12T10:00:00Z', resueltaEn: '2026-09-12T11:00:00Z',
  motivoCierre: 'Comprobante entregado en físico',
};

/* Por ENCABEZADO y no por texto: el título sale también en el texto oculto de
   los botones de su fila —para que «Reconocer» diga QUÉ reconoce—, así que
   buscarlo por texto encuentra dos. */
const esperarA = (titulo: string) => screen.findByRole('heading', { name: titulo });
const filaDe = async (titulo: string) => (await esperarA(titulo)).closest('li')!;

beforeEach(() => {
  jest.clearAllMocks();
  consulta = new URLSearchParams();
  api.listar.mockResolvedValue(ALERTAS);
  api.crear.mockResolvedValue({});
});

describe('la bandeja', () => {
  it('pide las abiertas por omisión: lo resuelto no es trabajo pendiente', async () => {
    render(<Alertas />);
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/alertas'));
  });

  it('respeta el orden del servidor, que ya viene por gravedad', async () => {
    // Reordenar aquí por fecha pondría una pérdida de GPS de hace un minuto por
    // encima de un sello roto de hace una hora.
    render(<Alertas />);
    await esperarA('Sello inconsistente en V-001');
    const titulos = screen.getAllByRole('listitem').map(li => within(li).getByRole('heading').textContent);
    expect(titulos).toEqual(['Sello inconsistente en V-001', 'Sin GPS en V-002']);
  });

  it('la gravedad se dice con PALABRAS, no sólo con color', async () => {
    render(<Alertas />);
    expect(within(await filaDe('Sello inconsistente en V-001')).getByText('Crítica')).toBeInTheDocument();
    expect(within(await filaDe('Sin GPS en V-002')).getByText('Media')).toBeInTheDocument();
  });

  it('cada alerta trae su estado', async () => {
    render(<Alertas />);
    expect(within(await filaDe('Sin GPS en V-002')).getByText('Reconocida')).toBeInTheDocument();
  });

  it('sin alertas abiertas lo dice en positivo', async () => {
    api.listar.mockResolvedValue([]);
    render(<Alertas />);
    expect(await screen.findByText('Ninguna alerta abierta.')).toBeInTheDocument();
  });

  it('un 403 se enseña, en vez de parecer una bandeja vacía', async () => {
    // «Ninguna alerta abierta» tras un 403 es la peor lectura posible: dice que
    // todo va bien a quien simplemente no puede verlo.
    api.listar.mockRejectedValue(new ErrorApi(403, 'Permisos insuficientes. Faltan: alertas:leer'));
    render(<Alertas />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Faltan: alertas:leer');
    expect(screen.queryByText('Ninguna alerta abierta.')).not.toBeInTheDocument();
  });
});

describe('el detalle, que llega como objeto', () => {
  const conDetalle = (detalle: unknown) =>
    api.listar.mockResolvedValue([{ ...ALERTAS[0], detalle }]);
  const detalleDe = async () =>
    within(await filaDe('Sello inconsistente en V-001'));

  it('se lee con nombres y nunca como «[object Object]»', async () => {
    render(<Alertas />);
    const fila = await detalleDe();
    expect(within(fila.getByRole('definition', { name: 'Sello recibido' }) as HTMLElement)
      .getByText('SELLO-78')).toBeInTheDocument();
    expect(fila.queryByText(/object Object/)).not.toBeInTheDocument();
  });

  it('el silencio del GPS en minutos, no en segundos', async () => {
    conDetalle({ ultima: '2026-09-13T12:28:00Z', silencioSegundos: 1320 });
    render(<Alertas />);
    expect((await detalleDe()).getByRole('definition', { name: 'Sin señal' })).toHaveTextContent('22 min');
  });

  it('la velocidad con su unidad, y el umbral al lado para comparar', async () => {
    conDetalle({ maxima: 97, lecturas: 14, umbral: 80 });
    render(<Alertas />);
    const fila = await detalleDe();
    expect(fila.getByRole('definition', { name: 'Velocidad máxima' })).toHaveTextContent('97 km/h');
    expect(fila.getByRole('definition', { name: 'Umbral' })).toHaveTextContent('80 km/h');
    expect(fila.getByRole('definition', { name: 'Lecturas' })).toHaveTextContent('14');
  });

  it('la merma como porcentaje, y un sí o un no donde había un booleano', async () => {
    conDetalle({ porcentajeMerma: '0.1672', vencida: true });
    render(<Alertas />);
    const fila = await detalleDe();
    expect(fila.getByRole('definition', { name: 'Merma' })).toHaveTextContent('0.17 %');
    expect(fila.getByRole('definition', { name: 'Vencida' })).toHaveTextContent('Sí');
  });

  it('una licencia POR VENCER dice «No» vencida, y el día en que vence', async () => {
    // `vencida: false` no es un dato vacío: es la diferencia entre «ya no puede
    // conducir» y «avísale antes del día 30».
    conDetalle({ vence: '2026-09-30T00:00:00Z', vencida: false });
    render(<Alertas />);
    const fila = await detalleDe();
    expect(fila.getByRole('definition', { name: 'Vencida' })).toHaveTextContent('No');
    expect(fila.getByRole('definition', { name: 'Vence' })).toHaveTextContent(/^2026-09-30$/);
  });

  it('lo nulo no se pinta como un dato vacío', async () => {
    conDetalle({ ultima: null, silencioSegundos: null, sello: 'SELLO-9' });
    render(<Alertas />);
    const fila = await detalleDe();
    expect(fila.queryByRole('definition', { name: 'Sin señal' })).not.toBeInTheDocument();
    expect(fila.queryByRole('definition', { name: 'Última posición' })).not.toBeInTheDocument();
    expect(fila.getByRole('definition', { name: 'Sello recibido' })).toBeInTheDocument();
  });

  it('una alerta sin detalle no deja una lista vacía', async () => {
    conDetalle(null);
    render(<Alertas />);
    expect((await detalleDe()).queryByRole('definition')).not.toBeInTheDocument();
  });

  it('una clave que la pantalla no conoce SE ENSEÑA igual, con su nombre', async () => {
    // El backend puede añadir un dato a una alerta sin tocar esta pantalla.
    // Esconder lo desconocido lo haría desaparecer justo cuando es nuevo.
    conDetalle({ kilometrosFueraDeRuta: 3.5 });
    render(<Alertas />);
    expect((await detalleDe()).getByRole('definition', { name: 'kilometrosFueraDeRuta' }))
      .toHaveTextContent('3.5');
  });
});

describe('un fallo no se queda pegado', () => {
  it('si la carga siguiente sale bien, el aviso de la anterior desaparece', async () => {
    // Un aviso que sobrevive a una carga correcta dice que algo va mal cuando
    // ya no va, y enseña a no leer los avisos.
    api.listar
      .mockRejectedValueOnce(new ErrorApi(503, 'La API no responde'))
      .mockResolvedValue(ALERTAS);
    const { rerender } = render(<Alertas />);
    expect(await screen.findByRole('alert')).toHaveTextContent('La API no responde');

    consulta = new URLSearchParams('ver=todas');
    rerender(<Alertas />);
    await esperarA('Sello inconsistente en V-001');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('lo que no es un error de la API', () => {
  it('un fallo de red también se dice, con palabras para personas', async () => {
    api.listar.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Alertas />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las alertas');
  });

  it('y también si falla al evaluar o al reconocer', async () => {
    const usuario = userEvent.setup();
    api.crear.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Alertas />);
    const fila = await filaDe('Sello inconsistente en V-001');
    await usuario.click(screen.getByRole('button', { name: /Evaluar ahora/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo evaluar');
    await usuario.click(within(fila).getByRole('button', { name: /Reconocer/ }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('No se pudo completar la acción'));
  });

  it('con «todas» y ninguna en absoluto, no dice «abierta»', async () => {
    consulta = new URLSearchParams('ver=todas');
    api.listar.mockResolvedValue([]);
    render(<Alertas />);
    expect(await screen.findByText('Ninguna alerta registrada.')).toBeInTheDocument();
  });

  it('el error TARDÍO de la vista anterior no aparece bajo la nueva', async () => {
    let fallarAbiertas!: (e: unknown) => void;
    const abiertas = new Promise((_, rej) => { fallarAbiertas = rej; });
    api.listar.mockImplementation((r: string) =>
      r === '/alertas' ? abiertas : Promise.resolve([RESUELTA]));
    const { rerender } = render(<Alertas />);
    consulta = new URLSearchParams('ver=todas');
    rerender(<Alertas />);
    await esperarA('Gasto sin comprobante');

    await act(async () => {
      fallarAbiertas(new ErrorApi(500, 'Se cayó la consulta vieja'));
      await abiertas.catch(() => undefined);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('ver también las resueltas vive en la URL', () => {
  it('marcarlo lo escribe en la URL', async () => {
    const usuario = userEvent.setup();
    render(<Alertas />);
    await usuario.click(await screen.findByRole('checkbox', { name: /resueltas/i }));
    await waitFor(() => expect(reemplazar).toHaveBeenCalledWith(
      expect.stringContaining('ver=todas'), { scroll: false }));
  });

  it('y con ello en la URL, se piden todas', async () => {
    consulta = new URLSearchParams('ver=todas');
    render(<Alertas />);
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/alertas?estado=todas'));
    expect(await screen.findByRole('checkbox', { name: /resueltas/i })).toBeChecked();
  });

  it('desmarcarlo lo QUITA de la URL', async () => {
    const usuario = userEvent.setup();
    consulta = new URLSearchParams('ver=todas');
    render(<Alertas />);
    await usuario.click(await screen.findByRole('checkbox', { name: /resueltas/i }));
    await waitFor(() => expect(reemplazar).toHaveBeenCalled());
    expect(String(reemplazar.mock.calls.at(-1)?.[0])).not.toMatch(/ver=/);
  });

  it('alternar rápido: la respuesta TARDÍA de la vista anterior no pisa la actual', async () => {
    let soltarAbiertas!: (v: unknown) => void;
    const abiertas = new Promise(res => { soltarAbiertas = res; });
    api.listar.mockImplementation((r: string) =>
      r === '/alertas' ? abiertas : Promise.resolve([RESUELTA]));
    const { rerender } = render(<Alertas />);

    consulta = new URLSearchParams('ver=todas');
    rerender(<Alertas />);
    await esperarA('Gasto sin comprobante');

    // Dentro de `act`: un `waitFor` encontraría la resuelta antes de que React
    // aplicara la respuesta tardía, y pasaría con la protección quitada.
    await act(async () => { soltarAbiertas(ALERTAS); await abiertas; });
    expect(screen.getByRole('heading', { name: 'Gasto sin comprobante' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sello inconsistente en V-001' })).not.toBeInTheDocument();
  });

  it('mientras llega la vista nueva, no se enseña la anterior bajo el filtro nuevo', async () => {
    // Con «ver también las resueltas» ya marcado, seguir enseñando la lista de
    // abiertas haría creer que no hay ninguna resuelta.
    api.listar.mockImplementation((r: string) =>
      r === '/alertas' ? Promise.resolve(ALERTAS) : new Promise(() => undefined));
    const { rerender } = render(<Alertas />);
    await esperarA('Sello inconsistente en V-001');

    consulta = new URLSearchParams('ver=todas');
    rerender(<Alertas />);
    expect(screen.queryByRole('heading', { name: 'Sello inconsistente en V-001' })).not.toBeInTheDocument();
  });

  it('una resuelta enseña POR QUÉ se cerró, y no ofrece nada', async () => {
    consulta = new URLSearchParams('ver=todas');
    api.listar.mockResolvedValue([RESUELTA]);
    render(<Alertas />);
    const fila = await filaDe('Gasto sin comprobante');
    expect(within(fila).getByText('Comprobante entregado en físico')).toBeInTheDocument();
    expect(within(fila).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('reconocer no es resolver', () => {
  it('una abierta se puede reconocer, y usa su propia ruta', async () => {
    const usuario = userEvent.setup();
    render(<Alertas />);
    const fila = await filaDe('Sello inconsistente en V-001');
    await usuario.click(within(fila).getByRole('button', { name: /Reconocer/ }));
    await waitFor(() => expect(api.crear).toHaveBeenCalledWith('/alertas/a1/reconocer', {}));
    // Y se vuelve a pedir la lista: el estado lo cuenta el servidor.
    await waitFor(() => expect(api.listar).toHaveBeenCalledTimes(2));
  });

  it('una ya reconocida no se reconoce otra vez, pero sí se resuelve', async () => {
    render(<Alertas />);
    const fila = await filaDe('Sin GPS en V-002');
    expect(within(fila).queryByRole('button', { name: /Reconocer/ })).not.toBeInTheDocument();
    expect(within(fila).getByRole('button', { name: /Resolver/ })).toBeInTheDocument();
  });

  it('el botón dice QUÉ alerta reconoce a quien navega por botones', async () => {
    render(<Alertas />);
    await esperarA('Sello inconsistente en V-001');
    expect(screen.getByRole('button', { name: /Reconocer.*Sello inconsistente en V-001/ })).toBeInTheDocument();
  });

  it('si otra persona se adelantó, el 409 se dice', async () => {
    const usuario = userEvent.setup();
    api.crear.mockRejectedValue(new ErrorApi(409, 'Esa alerta ya está "reconocida"'));
    render(<Alertas />);
    const fila = await filaDe('Sello inconsistente en V-001');
    await usuario.click(within(fila).getByRole('button', { name: /Reconocer/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esa alerta ya está "reconocida"');
  });
});

describe('resolver exige un motivo', () => {
  it('el botón espera a un motivo de al menos cinco caracteres', async () => {
    const usuario = userEvent.setup();
    render(<Alertas />);
    const fila = await filaDe('Sin GPS en V-002');
    const campo = within(fila).getByLabelText(/Motivo/);
    const boton = within(fila).getByRole('button', { name: /Resolver/ });
    expect(boton).toBeDisabled();
    await usuario.type(campo, 'ok  ');
    expect(boton).toBeDisabled();
    await usuario.type(campo, 'volvió la señal');
    expect(boton).toBeEnabled();
  });

  it('manda el motivo a la ruta de resolver', async () => {
    const usuario = userEvent.setup();
    render(<Alertas />);
    const fila = await filaDe('Sin GPS en V-002');
    await usuario.type(within(fila).getByLabelText(/Motivo/), 'Volvió la señal en Chilibre');
    await usuario.click(within(fila).getByRole('button', { name: /Resolver/ }));
    await waitFor(() => expect(api.crear).toHaveBeenCalledWith(
      '/alertas/a2/resolver', { motivo: 'Volvió la señal en Chilibre' }));
  });
});

describe('evaluar ahora', () => {
  it('dice CUÁNTAS nuevas encontró, y cuántas ya estaban', async () => {
    // Igual que revocar un dispositivo: «hecho» a secas no distingue una pasada
    // que no encontró nada de una que no llegó a correr.
    const usuario = userEvent.setup();
    api.crear.mockResolvedValue({ evaluadas: 5, nuevas: 3, yaAbiertas: 2 });
    render(<Alertas />);
    await esperarA('Sello inconsistente en V-001');
    await usuario.click(screen.getByRole('button', { name: /Evaluar ahora/ }));
    await waitFor(() => expect(api.crear).toHaveBeenCalledWith('/alertas/evaluar', {}));
    expect(await screen.findByRole('status')).toHaveTextContent(
      '3 alertas nuevas. Otras 2 ya estaban abiertas.');
    await waitFor(() => expect(api.listar).toHaveBeenCalledTimes(2));
  });

  it('una sola, y ninguna previa, se dice en singular y sin la segunda frase', async () => {
    const usuario = userEvent.setup();
    api.crear.mockResolvedValue({ evaluadas: 1, nuevas: 1, yaAbiertas: 0 });
    render(<Alertas />);
    await esperarA('Sello inconsistente en V-001');
    await usuario.click(screen.getByRole('button', { name: /Evaluar ahora/ }));
    expect(await screen.findByRole('status')).toHaveTextContent(/^1 alerta nueva\.$/);
  });

  it('sin hallazgos lo dice, y no como si hubiera fallado', async () => {
    const usuario = userEvent.setup();
    api.crear.mockResolvedValue({ evaluadas: 0, nuevas: 0, yaAbiertas: 0 });
    render(<Alertas />);
    await esperarA('Sello inconsistente en V-001');
    await usuario.click(screen.getByRole('button', { name: /Evaluar ahora/ }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'La evaluación no encontró nada que alertar.');
  });

  it('con hallazgos que ya estaban todos abiertos, no promete novedades', async () => {
    const usuario = userEvent.setup();
    api.crear.mockResolvedValue({ evaluadas: 4, nuevas: 0, yaAbiertas: 4 });
    render(<Alertas />);
    await esperarA('Sello inconsistente en V-001');
    await usuario.click(screen.getByRole('button', { name: /Evaluar ahora/ }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Nada nuevo: las 4 que encontró ya estaban abiertas.');
  });
});
