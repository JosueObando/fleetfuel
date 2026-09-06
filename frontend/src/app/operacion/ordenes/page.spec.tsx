import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Ordenes from './page';
import { ErrorApi } from '@/api/cliente';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { listar: jest.fn(), crear: jest.fn(), actualizar: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as {
  api: Record<'listar' | 'crear' | 'actualizar', jest.Mock>;
};

/*
 * La pantalla de órdenes. Es la puerta de entrada de la operación: aquí nace
 * todo lo que después se planifica y se transporta.
 */

const CLIENTES = [{ id: '1', nombre: 'Terpelo' }, { id: '2', nombre: 'Otro' }];
const ESTACIONES = [
  { id: '10', nombre: 'Vía España', clienteId: '1' },
  { id: '20', nombre: 'Ajena', clienteId: '2' },
];
const PRODUCTOS = [{ id: '9', nombre: 'Gasolina 95' }];
const ORDENES = [{
  id: '5', numeroOrdenExterna: 'EXT-1', cliente: 'Terpelo', estacion: 'Vía España',
  estado: 'recibida', volumenTotal: 4000, transicionesPosibles: ['validada', 'rechazada'],
}];

const listarPor = (r: string) =>
  r === '/ordenes' ? ORDENES : r === '/clientes' ? CLIENTES
  : r === '/estaciones' ? ESTACIONES : PRODUCTOS;

beforeEach(() => {
  jest.clearAllMocks();
  api.listar.mockImplementation((r: string) => Promise.resolve(listarPor(r)));
  api.crear.mockResolvedValue({ id: '6' });
  api.actualizar.mockResolvedValue({ id: '5' });
});

const abrir = async (usuario: ReturnType<typeof userEvent.setup>) => {
  await screen.findAllByText('EXT-1');
  await usuario.click(screen.getByRole('button', { name: /Nueva orden/ }));
  await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/clientes'));
};

describe('la estación depende del cliente', () => {
  it('sólo se ofrecen las estaciones DE ese cliente', async () => {
    // La API exige que la estación sea del cliente de la orden: ofrecer las
    // demás sería ofrecer un error que sólo se descubre al enviar.
    const usuario = userEvent.setup();
    render(<Ordenes />);
    await abrir(usuario);

    await usuario.selectOptions(screen.getByRole('combobox', { name: /Cliente/ }), '1');
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/estaciones'));

    const selector = screen.getByRole('combobox', { name: /Estación/ });
    const opciones = within(selector).getAllByRole('option').map(o => o.textContent ?? '');
    expect(opciones.some(o => o.includes('Vía España'))).toBe(true);
    expect(opciones.some(o => o.includes('Ajena'))).toBe(false);
  });

  it('cambiar de cliente BORRA la estación elegida', async () => {
    // Si se quedara puesta, se enviaría la estación del cliente anterior y el
    // servidor respondería «no pertenece al cliente indicado» — un error que la
    // persona no puede explicarse, porque en pantalla se veía coherente.
    const usuario = userEvent.setup();
    render(<Ordenes />);
    await abrir(usuario);

    await usuario.selectOptions(screen.getByRole('combobox', { name: /Cliente/ }), '1');
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/estaciones'));
    await usuario.selectOptions(screen.getByRole('combobox', { name: /Estación/ }), '10');
    expect(screen.getByRole('combobox', { name: /Estación/ })).toHaveValue('10');

    await usuario.selectOptions(screen.getByRole('combobox', { name: /Cliente/ }), '2');
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Estación/ })).toHaveValue(''));
  });

  it('sin cliente elegido no hay estaciones que ofrecer', async () => {
    const usuario = userEvent.setup();
    render(<Ordenes />);
    await abrir(usuario);
    const selector = screen.getByRole('combobox', { name: /Estación/ });
    expect(within(selector).queryAllByRole('option').filter(o => o.getAttribute('value'))).toHaveLength(0);
  });
});

describe('cambiar el estado de una orden', () => {
  it('avanzar por el flujo normal NO pide motivo', async () => {
    const usuario = userEvent.setup();
    const preguntar = jest.spyOn(window, 'prompt');
    render(<Ordenes />);
    await screen.findAllByText('EXT-1');

    await usuario.click(screen.getByRole('button', { name: /validada/ }));
    await waitFor(() => expect(api.actualizar).toHaveBeenCalled());
    expect(preguntar).not.toHaveBeenCalled();
    expect(api.actualizar).toHaveBeenCalledWith('/ordenes/5/estado', { estado: 'validada' });
  });

  it('los estados que sacan la orden del flujo SÍ piden motivo', async () => {
    const usuario = userEvent.setup();
    jest.spyOn(window, 'prompt').mockReturnValue('La estación está en obra');
    render(<Ordenes />);
    await screen.findAllByText('EXT-1');

    await usuario.click(screen.getByRole('button', { name: /rechazada/ }));
    await waitFor(() => expect(api.actualizar).toHaveBeenCalled());
    expect(api.actualizar).toHaveBeenCalledWith('/ordenes/5/estado',
      { estado: 'rechazada', motivo: 'La estación está en obra' });
  });

  it('cancelar la pregunta CANCELA la acción', async () => {
    // Si siguiera adelante sin motivo, el servidor devolvería 400 y la persona
    // habría cambiado de opinión pero el sistema no se habría enterado.
    const usuario = userEvent.setup();
    jest.spyOn(window, 'prompt').mockReturnValue(null);
    render(<Ordenes />);
    await screen.findAllByText('EXT-1');

    await usuario.click(screen.getByRole('button', { name: /rechazada/ }));
    expect(api.actualizar).not.toHaveBeenCalled();
  });

  it('un motivo vacío también cancela', async () => {
    const usuario = userEvent.setup();
    jest.spyOn(window, 'prompt').mockReturnValue('');
    render(<Ordenes />);
    await screen.findAllByText('EXT-1');
    await usuario.click(screen.getByRole('button', { name: /rechazada/ }));
    expect(api.actualizar).not.toHaveBeenCalled();
  });

  it('si el servidor rechaza la transición, lo dice', async () => {
    const usuario = userEvent.setup();
    api.actualizar.mockRejectedValue(
      new ErrorApi(409, 'No se puede pasar de "recibida" a "entregada"'));
    render(<Ordenes />);
    await screen.findAllByText('EXT-1');
    await usuario.click(screen.getByRole('button', { name: /validada/ }));
    expect(await screen.findByText(/No se puede pasar de/)).toBeInTheDocument();
  });

  it('sólo se ofrecen las transiciones que el servidor declara posibles', async () => {
    // La lista viene del backend (`transicionesPosibles`), no de una copia de la
    // máquina de estados en el frontend: dos copias se desincronizan.
    render(<Ordenes />);
    await screen.findAllByText('EXT-1');
    expect(screen.getByRole('button', { name: /validada/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /entregada/ })).not.toBeInTheDocument();
  });
});

describe('crear una orden', () => {
  it('los opcionales vacíos no viajan y los números van como número', async () => {
    const usuario = userEvent.setup();
    render(<Ordenes />);
    await abrir(usuario);

    await usuario.selectOptions(screen.getByRole('combobox', { name: /Cliente/ }), '1');
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/estaciones'));
    await usuario.selectOptions(screen.getByRole('combobox', { name: /Estación/ }), '10');
    await usuario.selectOptions(screen.getByRole('combobox', { name: /Producto/ }), '9');
    await usuario.type(screen.getByLabelText(/Volumen/), '4000');
    await usuario.click(screen.getByRole('button', { name: /Crear orden/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalled());
    expect(api.crear.mock.calls[0][1]).toEqual({
      clienteId: '1', estacionId: '10', prioridad: 'normal',
      detalles: [{ productoId: '9', volumenSolicitado: 4000 }],
    });
  });

  it('el volumen total de las líneas se ve mientras se rellena', async () => {
    const usuario = userEvent.setup();
    render(<Ordenes />);
    await abrir(usuario);
    await usuario.type(screen.getByLabelText(/Volumen/), '2500');
    expect(await screen.findByText(/2,500/)).toBeInTheDocument();
  });
});

describe('la lista', () => {
  it('sin órdenes lo dice', async () => {
    api.listar.mockImplementation((r: string) => Promise.resolve(r === '/ordenes' ? [] : listarPor(r)));
    render(<Ordenes />);
    expect(await screen.findByText(/Todavía no hay órdenes/i)).toBeInTheDocument();
  });

  it('un fallo de permisos se enseña tal cual', async () => {
    api.listar.mockImplementation((r: string) =>
      r === '/ordenes' ? Promise.reject(new ErrorApi(403, 'Permisos insuficientes. Faltan: ordenes:leer'))
                       : Promise.resolve(listarPor(r)));
    render(<Ordenes />);
    expect(await screen.findByText(/Faltan: ordenes:leer/)).toBeInTheDocument();
  });
});
