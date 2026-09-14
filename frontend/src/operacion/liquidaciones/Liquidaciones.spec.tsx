import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Liquidaciones } from './Liquidaciones';
import { ErrorApi } from '@/api/cliente';
import { rellenar } from '../../../pruebas/rellenar';

const reemplazar = jest.fn();
let consulta = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: reemplazar, push: jest.fn() }),
  usePathname: () => '/operacion/liquidaciones',
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
 * §7.18 · Las liquidaciones de todos los viajes, por el acto que les falta.
 *
 * `GET /liquidaciones` existía desde 1C sin pantalla: aprobar o pagar exigía
 * saber de qué viaje era y abrirlo en despacho. Calcular, aprobar y pagar son
 * tres actos con tres permisos y dos fechas; la pantalla los separa en tres
 * pestañas, y cada una ofrece SÓLO el acto que toca.
 *
 * Quien calculó no aprueba (409 del servidor, y la pantalla no ofrece el gesto).
 * Las filas se copian del `CAMPOS` de `liquidaciones.service.ts`.
 */

const YO = 'u7';

const liquidacion = (extra: Record<string, unknown> = {}) => ({
  id: 'l1', viajeId: '1', codigoViaje: 'V-001', conductorId: '3', conductor: 'Ana Pérez',
  estado: 'pendiente', kilometros: '120.00', entregasContadas: 2,
  pagoKilometros: '24.00', pagoEntregas: '10.00', reembolsos: '18.75',
  tarifaBase: '0.00', viaticos: '0.00', bonificaciones: '0.00', penalizaciones: '0.00',
  totalPagar: '52.75', calculadaPor: 'u2', aprobadaPor: null, fechaAprobacion: null,
  pagadaPor: null, fechaPago: null, referenciaPago: null,
  ...extra,
});

const esperarA = (texto: RegExp) => screen.findByRole('heading', { name: texto });
const filaDe = async (texto: RegExp) => (await esperarA(texto)).closest('li')!;

beforeEach(() => {
  jest.clearAllMocks();
  consulta = new URLSearchParams();
  window.localStorage.setItem('fleetfuel.sesion', JSON.stringify({
    accessToken: 't', usuario: { id: YO, nombre: 'Yo', correo: 'y@x', roles: [] },
  }));
  api.listar.mockResolvedValue([liquidacion(), liquidacion({ id: 'l2', codigoViaje: 'V-002', totalPagar: '40.00', calculadaPor: YO })]);
  api.crear.mockResolvedValue({});
});

afterEach(() => window.localStorage.clear());

describe('las tres pestañas son los tres actos, y viven en la URL', () => {
  it('sin nada en la URL se abre «Por aprobar» y se piden las pendientes', async () => {
    render(<Liquidaciones />);
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/liquidaciones?estado=pendiente'));
    expect(screen.getByRole('tab', { name: 'Por aprobar' })).toHaveAttribute('aria-selected', 'true');
  });

  it('con `?estado=aprobada` se abre «Por pagar»', async () => {
    consulta = new URLSearchParams('estado=aprobada');
    render(<Liquidaciones />);
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/liquidaciones?estado=aprobada'));
    expect(screen.getByRole('tab', { name: 'Por pagar' })).toHaveAttribute('aria-selected', 'true');
  });

  it('cambiar de pestaña lo escribe en la URL', async () => {
    const usuario = userEvent.setup();
    render(<Liquidaciones />);
    await usuario.click(await screen.findByRole('tab', { name: 'Pagadas' }));
    expect(reemplazar).toHaveBeenCalledWith(expect.stringContaining('estado=pagada'), { scroll: false });
  });

  it('un estado inventado en la URL no pide nada raro: vuelve a «Por aprobar»', async () => {
    consulta = new URLSearchParams('estado=borrada');
    render(<Liquidaciones />);
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/liquidaciones?estado=pendiente'));
  });

  it('mientras llega la pestaña nueva, no se enseña la lista de la anterior', async () => {
    api.listar.mockImplementation((r: string) => r.endsWith('pendiente')
      ? Promise.resolve([liquidacion()]) : new Promise(() => undefined));
    const { rerender } = render(<Liquidaciones />);
    await esperarA(/V-001/);
    consulta = new URLSearchParams('estado=pagada');
    rerender(<Liquidaciones />);
    expect(screen.queryByRole('heading', { name: /V-001/ })).not.toBeInTheDocument();
  });
});

describe('cada liquidación', () => {
  it('dice de qué viaje y conductor es, cuánto se paga y de dónde sale', async () => {
    render(<Liquidaciones />);
    const fila = await filaDe(/V-001/);
    expect(within(fila).getByRole('heading')).toHaveTextContent('V-001 · Ana Pérez');
    expect(within(fila).getByText('52.75')).toBeInTheDocument();
    expect(within(fila).getByText('120 km · 2 entregas · reembolsos 18.75')).toBeInTheDocument();
  });

  it('arriba, cuántas y por cuánto, con el verbo de la pestaña', async () => {
    render(<Liquidaciones />);
    expect(await screen.findByText('2 liquidaciones por aprobar, por 92.75 en total.')).toBeInTheDocument();
  });

  it('con una sola, en singular', async () => {
    consulta = new URLSearchParams('estado=aprobada');
    api.listar.mockResolvedValue([liquidacion({ estado: 'aprobada' })]);
    render(<Liquidaciones />);
    expect(await screen.findByText('1 liquidación por pagar, por 52.75 en total.')).toBeInTheDocument();
  });

  it('cada pestaña vacía lo dice a su manera', async () => {
    api.listar.mockResolvedValue([]);
    const { rerender } = render(<Liquidaciones />);
    expect(await screen.findByText('Ninguna liquidación por aprobar.')).toBeInTheDocument();
    consulta = new URLSearchParams('estado=aprobada');
    rerender(<Liquidaciones />);
    expect(await screen.findByText('Ninguna liquidación por pagar.')).toBeInTheDocument();
    consulta = new URLSearchParams('estado=pagada');
    rerender(<Liquidaciones />);
    expect(await screen.findByText('Ninguna liquidación pagada todavía.')).toBeInTheDocument();
  });

  it('un 403 se enseña, y no como una lista vacía', async () => {
    api.listar.mockRejectedValue(new ErrorApi(403, 'Faltan: liquidaciones:leer'));
    render(<Liquidaciones />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Faltan: liquidaciones:leer');
    expect(screen.queryByText('Ninguna liquidación por aprobar.')).not.toBeInTheDocument();
  });
});

describe('un fallo no se queda pegado', () => {
  it('el error de una pestaña desaparece al abrir otra que sí carga', async () => {
    // Un aviso que sobrevive a una carga correcta dice que algo va mal cuando
    // ya no va, y enseña a no leer los avisos.
    api.listar.mockImplementation((r: string) => r.endsWith('pendiente')
      ? Promise.reject(new ErrorApi(503, 'La API no responde'))
      : Promise.resolve([liquidacion({ estado: 'aprobada' })]));
    const { rerender } = render(<Liquidaciones />);
    expect(await screen.findByRole('alert')).toHaveTextContent('La API no responde');
    consulta = new URLSearchParams('estado=aprobada');
    rerender(<Liquidaciones />);
    await esperarA(/V-001/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('por aprobar: quien la calculó no la aprueba', () => {
  it('la ajena se aprueba con su propia ruta, y se dice cuál', async () => {
    const usuario = userEvent.setup();
    render(<Liquidaciones />);
    const fila = await filaDe(/V-001/);
    await usuario.click(within(fila).getByRole('button', { name: /Aprobar.*V-001/ }));
    await waitFor(() => expect(api.crear).toHaveBeenCalledWith('/liquidaciones/l1/aprobar', {}));
    expect(await screen.findByRole('status')).toHaveTextContent('Aprobada la liquidación de V-001.');
    await waitFor(() => expect(api.listar).toHaveBeenCalledTimes(2));
  });

  it('la propia no ofrece aprobar, y dice quién tiene que hacerlo', async () => {
    render(<Liquidaciones />);
    const propia = await filaDe(/V-002/);
    expect(within(propia).queryAllByRole('button')).toHaveLength(0);
    expect(within(propia).getByText('La calculaste tú: tiene que aprobarla otra persona.')).toBeInTheDocument();
  });

  it('sin saber quién mira no se ofrece aprobar ninguna', async () => {
    window.localStorage.clear();
    render(<Liquidaciones />);
    await esperarA(/V-001/);
    expect(screen.queryAllByRole('button', { name: /Aprobar/ })).toHaveLength(0);
  });

  it('en «Por aprobar» no se ofrece pagar', async () => {
    render(<Liquidaciones />);
    await esperarA(/V-001/);
    expect(screen.queryByRole('button', { name: /Registrar el pago/ })).not.toBeInTheDocument();
  });
});

describe('por pagar: el pago lleva su referencia', () => {
  beforeEach(() => {
    consulta = new URLSearchParams('estado=aprobada');
    api.listar.mockResolvedValue([liquidacion({ estado: 'aprobada', calculadaPor: YO })]);
  });

  it('la referencia espera a tres caracteres, como el DTO, y se manda con el pago', async () => {
    // Pagar no tiene la regla de separación: quien la calculó sí puede
    // registrar el pago que ya aprobó otra persona.
    const usuario = userEvent.setup();
    render(<Liquidaciones />);
    const fila = await filaDe(/V-001/);
    const pagar = within(fila).getByRole('button', { name: /Registrar el pago.*V-001/ });
    await rellenar(usuario, within(fila).getByLabelText(/Referencia/), 'TR');
    expect(pagar).toBeDisabled();
    await rellenar(usuario, within(fila).getByLabelText(/Referencia/), 'F-9');
    await usuario.click(pagar);
    await waitFor(() => expect(api.crear).toHaveBeenCalledWith(
      '/liquidaciones/l1/pagar', { referenciaPago: 'TRF-9' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Registrado el pago de V-001 con la referencia TRF-9.');
  });

  it('en «Por pagar» no se ofrece aprobar otra vez', async () => {
    render(<Liquidaciones />);
    await esperarA(/V-001/);
    expect(screen.queryByRole('button', { name: /Aprobar/ })).not.toBeInTheDocument();
  });

  it('si el servidor lo rechaza, se dice; un fallo de red, también', async () => {
    const usuario = userEvent.setup();
    api.crear.mockRejectedValueOnce(new ErrorApi(409, 'Esa liquidación ya está pagada'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<Liquidaciones />);
    const fila = await filaDe(/V-001/);
    await rellenar(usuario, within(fila).getByLabelText(/Referencia/), 'TRF-1');
    await usuario.click(within(fila).getByRole('button', { name: /Registrar el pago/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esa liquidación ya está pagada');
    await usuario.click(within(fila).getByRole('button', { name: /Registrar el pago/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No se pudo completar la acción'));
  });
});

describe('pagadas: sólo se leen', () => {
  it('dicen cuándo y con qué referencia, y no ofrecen nada', async () => {
    consulta = new URLSearchParams('estado=pagada');
    api.listar.mockResolvedValue([liquidacion({
      estado: 'pagada', fechaPago: '2026-09-12T15:00:00Z', referenciaPago: 'TRF-77' })]);
    render(<Liquidaciones />);
    const fila = await filaDe(/V-001/);
    expect(within(fila).getByText('Pagada el 2026-09-12 con la referencia TRF-77.')).toBeInTheDocument();
    expect(within(fila).queryAllByRole('button')).toHaveLength(0);
  });
});
