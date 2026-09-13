import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Solicitudes } from './Solicitudes';
import { ErrorApi } from '@/api/cliente';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { listar: jest.fn(), actualizar: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as {
  api: Record<'listar' | 'actualizar', jest.Mock>;
};

/*
 * §2C · Las solicitudes de cambio de ruta que esperan una decisión.
 *
 * El backend lleva desde el 2026-09-07 con la tabla, los permisos y la regla,
 * y ningún despachador podía resolver una sin curl.
 *
 * LO QUE MÁS IMPORTA DE ESTE FICHERO
 *
 * QUIEN PIDE NO RESUELVE. El permiso dice qué puede hacer un ROL; la regla dice
 * qué no puede hacer una PERSONA con su propia solicitud. El servidor la
 * aplica con un 409, y la pantalla no debe ni ofrecer el gesto: un botón que
 * existe para fallar enseña que los botones mienten. Y resolver —en los DOS
 * sentidos— exige motivo: un «sí» sin razón es el permiso que nadie tendrá que
 * explicar.
 */

const YO = 'u7';

const PENDIENTES = [
  { id: 's1', viajeId: '1', codigoViaje: 'V-001', tipo: 'desvio', estado: 'pendiente',
    motivo: 'Calle cerrada en Vía España', solicitadaPor: 'u2', solicitante: 'Luis Gómez',
    solicitadaEn: '2026-09-13T08:00:00Z' },
  { id: 's2', viajeId: '2', codigoViaje: 'V-002', tipo: 'parada_extra', estado: 'pendiente',
    motivo: 'Recoger el sello de repuesto', solicitadaPor: YO, solicitante: 'Ana Pérez',
    solicitadaEn: '2026-09-13T08:30:00Z' },
];

const esperarA = (codigo: string) => screen.findByRole('heading', { name: new RegExp(codigo) });
const filaDe = async (codigo: string) => (await esperarA(codigo)).closest('li')!;

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.setItem('fleetfuel.sesion', JSON.stringify({
    accessToken: 't', usuario: { id: YO, nombre: 'Ana Pérez', correo: 'ana@x', roles: [] },
  }));
  api.listar.mockResolvedValue(PENDIENTES);
  api.actualizar.mockResolvedValue({});
});

afterEach(() => window.localStorage.clear());

describe('la bandeja', () => {
  it('pide sólo las pendientes: es lo que espera una decisión', async () => {
    render(<Solicitudes />);
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/solicitudes-ruta/pendientes'));
  });

  it('en el orden del servidor, la más antigua primero', async () => {
    // Una cola de permisos que se atiende por la más reciente deja a un camión
    // parado esperando mientras se resuelven las que llegaron después.
    render(<Solicitudes />);
    await esperarA('V-001');
    const titulos = screen.getAllByRole('listitem').map(li => within(li).getByRole('heading').textContent);
    expect(titulos[0]).toMatch(/V-001/);
    expect(titulos[1]).toMatch(/V-002/);
  });

  it('dice QUÉ se pide en palabras, POR QUÉ y QUIÉN lo pide', async () => {
    render(<Solicitudes />);
    const fila = await filaDe('V-001');
    expect(within(fila).getByRole('heading')).toHaveTextContent('Desvío · V-001');
    expect(within(fila).getByText('Calle cerrada en Vía España')).toBeInTheDocument();
    expect(within(fila).getByText(/Luis Gómez/)).toBeInTheDocument();
    expect(within(await filaDe('V-002')).getByRole('heading')).toHaveTextContent('Parada extra · V-002');
  });

  it('una cancelación también se nombra', async () => {
    api.listar.mockResolvedValue([{ ...PENDIENTES[0], tipo: 'cancelacion' }]);
    render(<Solicitudes />);
    expect(within(await filaDe('V-001')).getByRole('heading')).toHaveTextContent('Cancelación · V-001');
  });

  it('sin pendientes lo dice', async () => {
    api.listar.mockResolvedValue([]);
    render(<Solicitudes />);
    expect(await screen.findByText('Ninguna solicitud espera decisión.')).toBeInTheDocument();
  });

  it('un 403 se enseña, en vez de parecer que no hay nada', async () => {
    api.listar.mockRejectedValue(new ErrorApi(403, 'Permisos insuficientes. Faltan: solicitudesruta:leer'));
    render(<Solicitudes />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Faltan: solicitudesruta:leer');
    expect(screen.queryByText('Ninguna solicitud espera decisión.')).not.toBeInTheDocument();
  });
});

describe('quien pide no resuelve', () => {
  it('la solicitud PROPIA no ofrece ni motivo ni botones, y dice por qué', async () => {
    render(<Solicitudes />);
    const propia = await filaDe('V-002');
    expect(within(propia).queryAllByRole('button')).toHaveLength(0);
    expect(within(propia).queryByLabelText(/Motivo/)).not.toBeInTheDocument();
    expect(within(propia).getByText('La pediste tú: tiene que resolverla otra persona.')).toBeInTheDocument();
  });

  it('la de otra persona sí se puede resolver', async () => {
    render(<Solicitudes />);
    const ajena = await filaDe('V-001');
    expect(within(ajena).getByRole('button', { name: /Aprobar/ })).toBeInTheDocument();
    expect(within(ajena).getByRole('button', { name: /Rechazar/ })).toBeInTheDocument();
  });

  it('si el servidor aun así lo impide, su mensaje se ve', async () => {
    // La pantalla compara con la sesión; el servidor, con el token. Si difieren
    // —la sesión cambió en otra pestaña— manda el servidor, y hay que decirlo.
    const usuario = userEvent.setup();
    api.actualizar.mockRejectedValue(
      new ErrorApi(409, 'Quien la pidió no puede resolverla: tiene que hacerlo otra persona'));
    render(<Solicitudes />);
    const fila = await filaDe('V-001');
    await usuario.type(within(fila).getByLabelText(/Motivo/), 'Ruta alterna despejada');
    await usuario.click(within(fila).getByRole('button', { name: /Aprobar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Quien la pidió no puede resolverla');
  });
});

describe('resolver exige motivo, en los dos sentidos', () => {
  it('aprobar y rechazar esperan a un motivo de cinco caracteres', async () => {
    const usuario = userEvent.setup();
    render(<Solicitudes />);
    const fila = await filaDe('V-001');
    const aprobar = within(fila).getByRole('button', { name: /Aprobar/ });
    const rechazar = within(fila).getByRole('button', { name: /Rechazar/ });
    expect(aprobar).toBeDisabled();
    expect(rechazar).toBeDisabled();
    await usuario.type(within(fila).getByLabelText(/Motivo/), '  sí ');
    expect(aprobar).toBeDisabled();
    await usuario.type(within(fila).getByLabelText(/Motivo/), 'por Transístmica');
    expect(aprobar).toBeEnabled();
    expect(rechazar).toBeEnabled();
  });

  it('aprobar manda estado y motivo a su ruta, y recarga la bandeja', async () => {
    const usuario = userEvent.setup();
    render(<Solicitudes />);
    const fila = await filaDe('V-001');
    await usuario.type(within(fila).getByLabelText(/Motivo/), 'Ruta alterna despejada');
    await usuario.click(within(fila).getByRole('button', { name: /Aprobar/ }));
    await waitFor(() => expect(api.actualizar).toHaveBeenCalledWith(
      '/solicitudes-ruta/s1', { estado: 'aprobada', motivo: 'Ruta alterna despejada' }));
    await waitFor(() => expect(api.listar).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('status')).toHaveTextContent('Aprobado el desvío de V-001.');
  });

  it('rechazar usa el mismo motivo y lo dice', async () => {
    const usuario = userEvent.setup();
    render(<Solicitudes />);
    const fila = await filaDe('V-001');
    await usuario.type(within(fila).getByLabelText(/Motivo/), 'La calle ya abrió');
    await usuario.click(within(fila).getByRole('button', { name: /Rechazar/ }));
    await waitFor(() => expect(api.actualizar).toHaveBeenCalledWith(
      '/solicitudes-ruta/s1', { estado: 'rechazada', motivo: 'La calle ya abrió' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Rechazado el desvío de V-001.');
  });

  it('el aviso concuerda con lo que se resolvió: «rechazada la parada extra»', async () => {
    const usuario = userEvent.setup();
    api.listar.mockResolvedValue([{ ...PENDIENTES[1], solicitadaPor: 'u2' }]);
    render(<Solicitudes />);
    const fila = await filaDe('V-002');
    await usuario.type(within(fila).getByLabelText(/Motivo/), 'El sello llega en terminal');
    await usuario.click(within(fila).getByRole('button', { name: /Rechazar/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('Rechazada la parada extra de V-002.');
  });

  it('los botones dicen QUÉ solicitud resuelven a quien navega por botones', async () => {
    render(<Solicitudes />);
    await esperarA('V-001');
    expect(screen.getByRole('button', { name: /Aprobar.*V-001/ })).toBeInTheDocument();
  });
});

describe('lo que llega mal o tarde', () => {
  it('un fallo de red se dice con palabras, al cargar y al resolver', async () => {
    const usuario = userEvent.setup();
    api.listar.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { unmount } = render(<Solicitudes />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las solicitudes');
    unmount();

    api.actualizar.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Solicitudes />);
    const fila = await filaDe('V-001');
    await usuario.type(within(fila).getByLabelText(/Motivo/), 'Ruta alterna despejada');
    await usuario.click(within(fila).getByRole('button', { name: /Aprobar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo resolver la solicitud');
  });

  it('dos resoluciones seguidas: la bandeja VIEJA que llega tarde no resucita lo resuelto', async () => {
    // Resolver recarga la bandeja. Si se resuelven dos seguidas y la primera
    // recarga contesta la última, volverían a aparecer como pendientes las que
    // ya se aprobaron — y alguien las aprobaría otra vez.
    const usuario = userEvent.setup();
    const OTRA = { ...PENDIENTES[0], id: 's3', codigoViaje: 'V-003', solicitadaPor: 'u2' };
    let soltarVieja!: (v: unknown) => void;
    const vieja = new Promise(res => { soltarVieja = res; });
    api.listar
      .mockResolvedValueOnce([PENDIENTES[0], OTRA])  // la carga inicial
      .mockReturnValueOnce(vieja)                     // la recarga tras la primera
      .mockResolvedValueOnce([]);                     // la recarga tras la segunda
    render(<Solicitudes />);

    const primera = await filaDe('V-001');
    await usuario.type(within(primera).getByLabelText(/Motivo/), 'Ruta alterna despejada');
    await usuario.click(within(primera).getByRole('button', { name: /Aprobar/ }));
    const segunda = await filaDe('V-003');
    await usuario.type(within(segunda).getByLabelText(/Motivo/), 'También despejada');
    await usuario.click(within(segunda).getByRole('button', { name: /Aprobar/ }));
    expect(await screen.findByText('Ninguna solicitud espera decisión.')).toBeInTheDocument();

    await act(async () => { soltarVieja([PENDIENTES[0], OTRA]); await vieja; });
    expect(screen.queryByRole('heading', { name: /V-001/ })).not.toBeInTheDocument();
    expect(screen.getByText('Ninguna solicitud espera decisión.')).toBeInTheDocument();
  });

  it('y si esa bandeja vieja FALLA tarde, su error tampoco aparece', async () => {
    const usuario = userEvent.setup();
    const OTRA = { ...PENDIENTES[0], id: 's3', codigoViaje: 'V-003', solicitadaPor: 'u2' };
    let fallarVieja!: (e: unknown) => void;
    const vieja = new Promise((_, rej) => { fallarVieja = rej; });
    api.listar
      .mockResolvedValueOnce([PENDIENTES[0], OTRA])
      .mockReturnValueOnce(vieja)
      .mockResolvedValueOnce([]);
    render(<Solicitudes />);

    const primera = await filaDe('V-001');
    await usuario.type(within(primera).getByLabelText(/Motivo/), 'Ruta alterna despejada');
    await usuario.click(within(primera).getByRole('button', { name: /Aprobar/ }));
    const segunda = await filaDe('V-003');
    await usuario.type(within(segunda).getByLabelText(/Motivo/), 'También despejada');
    await usuario.click(within(segunda).getByRole('button', { name: /Aprobar/ }));
    expect(await screen.findByText('Ninguna solicitud espera decisión.')).toBeInTheDocument();

    await act(async () => {
      fallarVieja(new ErrorApi(500, 'Se cayó la bandeja vieja'));
      await vieja.catch(() => undefined);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('sin sesión legible', () => {
  it('no ofrece resolver nada: sin saber quién mira, no se sabe qué es propio', async () => {
    // Ofrecerlo todo sería ofrecer también lo propio. El servidor lo pararía,
    // pero ya habría un botón que existe para fallar.
    window.localStorage.clear();
    render(<Solicitudes />);
    await esperarA('V-001');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
