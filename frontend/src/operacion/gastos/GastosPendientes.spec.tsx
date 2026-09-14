import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GastosPendientes } from './GastosPendientes';
import { ErrorApi } from '@/api/cliente';
import { rellenar } from '../../../pruebas/rellenar';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { listar: jest.fn(), actualizar: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as {
  api: Record<'listar' | 'actualizar', jest.Mock>;
};

/*
 * §7.17 · Los gastos que esperan aprobación, de TODOS los viajes.
 *
 * `GET /gastos/pendientes` existe desde la Fase 1C y ninguna pantalla lo
 * llamaba: para aprobar los peajes de la semana había que abrir los viajes en
 * despacho uno por uno. Es el trabajo de Finanzas, y se hace de una sentada.
 *
 * LO QUE MÁS IMPORTA DE ESTE FICHERO
 *
 * Que un gasto SIN COMPROBANTE se vea como tal antes de aprobarlo —el §22
 * alerta de él después, cuando ya se aprobó— y que quien lo registró no pueda
 * aprobárselo. La forma de las filas se copia del `CAMPOS` de
 * `gastos.service.ts`, no se imagina.
 */

const YO = 'u7';

const PENDIENTES = [
  { id: 'x1', viajeId: '1', codigoViaje: 'V-001', categoria: 'peaje', descripcion: 'Corredor Norte',
    monto: '18.75', fecha: '2026-09-12', comprobante: 'F-88', pagadoPor: 'conductor',
    reembolsable: true, estado: 'pendiente', registradoPor: 'u2', registrante: 'Luis Gómez' },
  { id: 'x2', viajeId: '2', codigoViaje: 'V-002', categoria: 'viatico', descripcion: 'Almuerzo',
    monto: '9.50', fecha: '2026-09-13', comprobante: null, pagadoPor: 'empresa',
    reembolsable: false, estado: 'pendiente', registradoPor: YO, registrante: 'Ana Pérez' },
];

const esperarA = (texto: RegExp) => screen.findByRole('heading', { name: texto });
const filaDe = async (texto: RegExp) => (await esperarA(texto)).closest('li')!;

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.setItem('fleetfuel.sesion', JSON.stringify({
    accessToken: 't', usuario: { id: YO, nombre: 'Ana Pérez', correo: 'a@x', roles: [] },
  }));
  api.listar.mockResolvedValue(PENDIENTES);
  api.actualizar.mockResolvedValue({});
});

afterEach(() => window.localStorage.clear());

describe('la bandeja', () => {
  it('pide los pendientes de todos los viajes, en el orden del servidor', async () => {
    render(<GastosPendientes />);
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/gastos/pendientes'));
    await esperarA(/V-001/);
    const titulos = screen.getAllByRole('listitem').map(li => within(li).getByRole('heading').textContent);
    expect(titulos).toEqual(['Peaje · V-001', 'Viático · V-002']);
  });

  it('cada gasto dice qué, cuánto, quién pagó y quién lo registró', async () => {
    render(<GastosPendientes />);
    const fila = await filaDe(/V-001/);
    expect(within(fila).getByText('Corredor Norte')).toBeInTheDocument();
    expect(within(fila).getByText(/18\.75/)).toBeInTheDocument();
    expect(within(fila).getByText(/Pagó el conductor · se le reembolsa/)).toBeInTheDocument();
    expect(within(fila).getByText(/Luis Gómez/)).toBeInTheDocument();
    expect(within(await filaDe(/V-002/)).getByText(/Pagó la empresa/)).toBeInTheDocument();
  });

  it('un gasto SIN comprobante se señala antes de aprobarlo, no después', async () => {
    render(<GastosPendientes />);
    expect(within(await filaDe(/V-002/)).getByText('Sin comprobante')).toBeInTheDocument();
    expect(within(await filaDe(/V-001/)).queryByText('Sin comprobante')).not.toBeInTheDocument();
    expect(within(await filaDe(/V-001/)).getByText(/Comprobante F-88/)).toBeInTheDocument();
  });

  it('arriba, cuántos esperan y por cuánto dinero', async () => {
    render(<GastosPendientes />);
    expect(await screen.findByText('2 gastos esperan aprobación, por 28.25 en total.')).toBeInTheDocument();
  });

  it('con uno solo, en singular', async () => {
    api.listar.mockResolvedValue([PENDIENTES[0]]);
    render(<GastosPendientes />);
    expect(await screen.findByText('1 gasto espera aprobación, por 18.75 en total.')).toBeInTheDocument();
  });

  it('sin pendientes lo dice', async () => {
    api.listar.mockResolvedValue([]);
    render(<GastosPendientes />);
    expect(await screen.findByText('Ningún gasto espera aprobación.')).toBeInTheDocument();
  });

  it('un 403 se enseña, en vez de parecer que no hay nada', async () => {
    api.listar.mockRejectedValue(new ErrorApi(403, 'Faltan: gastos:leer'));
    render(<GastosPendientes />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Faltan: gastos:leer');
    expect(screen.queryByText('Ningún gasto espera aprobación.')).not.toBeInTheDocument();
  });

  it('un fallo de red también se dice', async () => {
    api.listar.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<GastosPendientes />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los gastos');
  });
});

describe('quien lo registró no lo aprueba', () => {
  it('sobre el propio no hay motivo ni botones, y se dice por qué', async () => {
    render(<GastosPendientes />);
    const propio = await filaDe(/V-002/);
    expect(within(propio).queryAllByRole('button')).toHaveLength(0);
    expect(within(propio).getByText('Lo registraste tú: tiene que aprobarlo otra persona.')).toBeInTheDocument();
  });

  it('sin saber quién mira no se ofrece nada', async () => {
    window.localStorage.clear();
    render(<GastosPendientes />);
    await esperarA(/V-001/);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('aprobar y rechazar, con motivo', () => {
  it('los dos botones esperan a un motivo de cinco caracteres', async () => {
    const usuario = userEvent.setup();
    render(<GastosPendientes />);
    const fila = await filaDe(/V-001/);
    const aprobar = within(fila).getByRole('button', { name: /Aprobar/ });
    expect(aprobar).toBeDisabled();
    await rellenar(usuario, within(fila).getByLabelText(/Motivo/), 'okey');
    expect(aprobar).toBeDisabled();
    expect(within(fila).getByRole('button', { name: /Rechazar/ })).toBeDisabled();
    await rellenar(usuario, within(fila).getByLabelText(/Motivo/), '!');
    expect(aprobar).toBeEnabled();
  });

  it('aprobar manda estado y motivo, dice qué aprobó y recarga', async () => {
    const usuario = userEvent.setup();
    render(<GastosPendientes />);
    const fila = await filaDe(/V-001/);
    await rellenar(usuario, within(fila).getByLabelText(/Motivo/), 'F-88 ok');
    await usuario.click(within(fila).getByRole('button', { name: /Aprobar/ }));
    await waitFor(() => expect(api.actualizar).toHaveBeenCalledWith(
      '/gastos/x1', { estado: 'aprobado', motivo: 'F-88 ok' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Aprobado el gasto de 18.75 de V-001.');
    await waitFor(() => expect(api.listar).toHaveBeenCalledTimes(2));
  });

  it('rechazar también lo dice', async () => {
    const usuario = userEvent.setup();
    render(<GastosPendientes />);
    const fila = await filaDe(/V-001/);
    await rellenar(usuario, within(fila).getByLabelText(/Motivo/), 'Doble');
    await usuario.click(within(fila).getByRole('button', { name: /Rechazar/ }));
    await waitFor(() => expect(api.actualizar).toHaveBeenCalledWith(
      '/gastos/x1', { estado: 'rechazado', motivo: 'Doble' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Rechazado el gasto de 18.75 de V-001.');
  });

  it('los botones dicen QUÉ gasto resuelven a quien navega por botones', async () => {
    render(<GastosPendientes />);
    await esperarA(/V-001/);
    expect(screen.getByRole('button', { name: /Aprobar.*peaje de V-001/i })).toBeInTheDocument();
    // Con su tilde: un lector de pantalla lee la palabra, no la clave del DTO.
    window.localStorage.setItem('fleetfuel.sesion', JSON.stringify({
      accessToken: 't', usuario: { id: 'otra', nombre: 'Otra', correo: 'o@x', roles: [] } }));
    window.dispatchEvent(new StorageEvent('storage'));
    expect(await screen.findByRole('button', { name: /Aprobar.*viático de V-002/i })).toBeInTheDocument();
  });

  it('si otra persona se adelantó, el 409 se dice; y un fallo de red, también', async () => {
    const usuario = userEvent.setup();
    api.actualizar.mockRejectedValueOnce(new ErrorApi(409, 'Ese gasto ya está "aprobado"'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<GastosPendientes />);
    const fila = await filaDe(/V-001/);
    await rellenar(usuario, within(fila).getByLabelText(/Motivo/), 'Listo');
    await usuario.click(within(fila).getByRole('button', { name: /Aprobar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ese gasto ya está "aprobado"');
    await usuario.click(within(fila).getByRole('button', { name: /Aprobar/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No se pudo resolver el gasto'));
  });
});
