import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Cisternas from './page';
import { ErrorApi } from '@/api/cliente';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { listar: jest.fn(), crear: jest.fn(), desactivar: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as {
  api: Record<'listar' | 'crear' | 'desactivar', jest.Mock>;
};

/*
 * Cisternas no usa el molde genérico de los catálogos: sus compartimentos son
 * filas anidadas con dos reglas propias —la suma no puede exceder el tanque y
 * los números no se repiten— y se crean CON la cisterna, en la misma petición.
 *
 * La regla de la suma vive DOS veces a propósito: aquí para verla mientras se
 * rellena, y en el servidor porque es donde de verdad se hace cumplir. Esta
 * prueba fija la de aquí; `catalogos-servicio.integracion.ts` fija la de allí.
 */

const VEHICULOS = [
  { id: '1', placa: 'CL-001', marca: 'Volvo', tipoVehiculo: 'cisterna' },
  { id: '2', placa: 'CB-002', marca: 'Scania', tipoVehiculo: 'cabezal' },
  { id: '3', placa: 'IN-003', marca: 'Mack', tipoVehiculo: 'integrada' },
];
const PRODUCTOS = [{ id: '9', nombre: 'Gasolina 95' }];
const CISTERNAS = [{ id: '7', placa: 'CL-001', capacidadTotal: 10000, estado: 'disponible' }];

const listarPor = (ruta: string) =>
  ruta === '/cisternas' ? CISTERNAS : ruta === '/vehiculos' ? VEHICULOS : PRODUCTOS;

beforeEach(() => {
  jest.clearAllMocks();
  api.listar.mockImplementation((ruta: string) => Promise.resolve(listarPor(ruta)));
  api.crear.mockResolvedValue({ id: '8' });
  api.desactivar.mockResolvedValue(undefined);
});

const abrirFormulario = async (usuario: ReturnType<typeof userEvent.setup>) => {
  await screen.findAllByText('CL-001');
  await usuario.click(screen.getByRole('button', { name: /Nueva cisterna/ }));
  await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/vehiculos'));
};

describe('qué vehículos se ofrecen', () => {
  it('sólo cisternas e integradas, nunca un cabezal', async () => {
    // La API lo rechaza igualmente; filtrar aquí evita ofrecer una opción que se
    // sabe que va a fallar, que es la peor clase de formulario.
    const usuario = userEvent.setup();
    render(<Cisternas />);
    await abrirFormulario(usuario);

    const selector = screen.getByRole('combobox', { name: /Vehículo/ });
    const opciones = within(selector).getAllByRole('option').map(o => o.textContent ?? '');
    expect(opciones.some(o => o.includes('CL-001'))).toBe(true);
    expect(opciones.some(o => o.includes('IN-003'))).toBe(true);
    expect(opciones.some(o => o.includes('CB-002'))).toBe(false);
  });
});

describe('la suma de los compartimentos', () => {
  it('se ve MIENTRAS se rellena, no sólo al enviar', async () => {
    // Es lo que evita descubrir el exceso después de teclear doce filas.
    const usuario = userEvent.setup();
    render(<Cisternas />);
    await abrirFormulario(usuario);

    await usuario.type(screen.getByLabelText(/Capacidad total/), '10000');
    await usuario.type(screen.getByLabelText(/Nominal/), '4000');
    expect(await screen.findByText(/4,000 de 10,000/)).toBeInTheDocument();
  });

  it('avisa cuando excede y BLOQUEA el envío', async () => {
    const usuario = userEvent.setup();
    render(<Cisternas />);
    await abrirFormulario(usuario);

    await usuario.type(screen.getByLabelText(/Capacidad total/), '5000');
    await usuario.type(screen.getByLabelText(/Nominal/), '6000');

    expect(await screen.findByText(/excede la capacidad/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear cisterna/ })).toBeDisabled();
  });

  it('se anuncia sola a quien no la ve', async () => {
    // `aria-live=polite`: el aviso aparece sin mover el foco, así que sin esto
    // quien usa lector de pantalla se entera al enviar y no antes.
    const usuario = userEvent.setup();
    const { container } = render(<Cisternas />);
    await abrirFormulario(usuario);
    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });

  it('sin capacidad total todavía no acusa exceso', async () => {
    // Con el campo vacío, `total` es 0 y cualquier suma lo superaría: marcar
    // exceso ahí sería gritarle a alguien que aún no ha terminado de escribir.
    const usuario = userEvent.setup();
    render(<Cisternas />);
    await abrirFormulario(usuario);
    await usuario.type(screen.getByLabelText(/Nominal/), '6000');
    expect(screen.queryByText(/excede la capacidad/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear cisterna/ })).not.toBeDisabled();
  });
});

describe('añadir y quitar compartimentos', () => {
  it('empieza con uno, y no se puede quitar el último', async () => {
    // Una cisterna sin compartimentos no es una cisterna.
    const usuario = userEvent.setup();
    render(<Cisternas />);
    await abrirFormulario(usuario);
    expect(screen.getAllByLabelText(/N\.º/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Quitar/ })).toBeDisabled();
  });

  it('añadir numera el siguiente solo', async () => {
    const usuario = userEvent.setup();
    render(<Cisternas />);
    await abrirFormulario(usuario);
    await usuario.click(screen.getByRole('button', { name: /Añadir compartimento/ }));
    const numeros = screen.getAllByLabelText(/N\.º/) as HTMLInputElement[];
    expect(numeros.map(n => n.value)).toEqual(['1', '2']);
  });

  it('el tope son doce', async () => {
    const usuario = userEvent.setup();
    render(<Cisternas />);
    await abrirFormulario(usuario);
    const añadir = screen.getByRole('button', { name: /Añadir compartimento/ });
    for (let i = 0; i < 11; i++) await usuario.click(añadir);
    expect(screen.getAllByLabelText(/N\.º/)).toHaveLength(12);
    expect(añadir).toBeDisabled();
  });

  it('quitar uno deja el resto intacto', async () => {
    const usuario = userEvent.setup();
    render(<Cisternas />);
    await abrirFormulario(usuario);
    await usuario.click(screen.getByRole('button', { name: /Añadir compartimento/ }));
    const nominales = screen.getAllByLabelText(/Nominal/);
    await usuario.type(nominales[1], '3000');
    await usuario.click(screen.getAllByRole('button', { name: /Quitar/ })[0]);

    const quedan = screen.getAllByLabelText(/Nominal/) as HTMLInputElement[];
    expect(quedan).toHaveLength(1);
    expect(quedan[0].value).toBe('3000');
  });
});

describe('lo que se envía', () => {
  it('los opcionales vacíos NO viajan, y los números van como número', async () => {
    const usuario = userEvent.setup();
    render(<Cisternas />);
    await abrirFormulario(usuario);

    await usuario.selectOptions(screen.getByRole('combobox', { name: /Vehículo/ }), '1');
    await usuario.type(screen.getByLabelText(/Capacidad total/), '9000');
    await usuario.type(screen.getByLabelText(/Nominal/), '4000');
    await usuario.type(screen.getByLabelText(/Calibrada/), '3980');
    await usuario.click(screen.getByRole('button', { name: /Crear cisterna/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalled());
    expect(api.crear.mock.calls[0][1]).toEqual({
      vehiculoId: '1',
      capacidadTotal: 9000,
      compartimentos: [{ numero: 1, capacidadNominal: 4000, capacidadCalibrada: 3980 }],
    });
  });

  it('tras crear, recarga la lista y limpia el formulario', async () => {
    const usuario = userEvent.setup();
    render(<Cisternas />);
    await abrirFormulario(usuario);

    await usuario.selectOptions(screen.getByRole('combobox', { name: /Vehículo/ }), '1');
    await usuario.type(screen.getByLabelText(/Capacidad total/), '9000');
    await usuario.type(screen.getByLabelText(/Nominal/), '4000');
    await usuario.type(screen.getByLabelText(/Calibrada/), '3980');
    await usuario.click(screen.getByRole('button', { name: /Crear cisterna/ }));

    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/cisternas'));
    expect(api.listar.mock.calls.filter(c => c[0] === '/cisternas')).toHaveLength(2);
    expect(screen.queryByLabelText(/Capacidad total/)).not.toBeInTheDocument();
  });

  it('si el servidor rechaza, el formulario sigue abierto con el mensaje', async () => {
    const usuario = userEvent.setup();
    api.crear.mockRejectedValue(new ErrorApi(409, 'Ese vehículo ya tiene una cisterna registrada'));
    render(<Cisternas />);
    await abrirFormulario(usuario);

    await usuario.selectOptions(screen.getByRole('combobox', { name: /Vehículo/ }), '1');
    await usuario.type(screen.getByLabelText(/Capacidad total/), '9000');
    await usuario.type(screen.getByLabelText(/Nominal/), '4000');
    await usuario.type(screen.getByLabelText(/Calibrada/), '3980');
    await usuario.click(screen.getByRole('button', { name: /Crear cisterna/ }));

    expect(await screen.findByText(/ya tiene una cisterna registrada/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Capacidad total/)).toBeInTheDocument();
  });
});

describe('la lista', () => {
  it('sin cisternas lo dice', async () => {
    api.listar.mockImplementation((r: string) => Promise.resolve(r === '/cisternas' ? [] : listarPor(r)));
    render(<Cisternas />);
    expect(await screen.findByText(/Todavía no hay cisternas/)).toBeInTheDocument();
  });

  it('dar de baja pregunta nombrando la PLACA', async () => {
    const usuario = userEvent.setup();
    const confirmar = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Cisternas />);
    await screen.findAllByText('CL-001');
    await usuario.click(screen.getByRole('button', { name: /Dar de baja/ }));
    expect(confirmar.mock.calls[0][0]).toContain('CL-001');
    expect(api.desactivar).not.toHaveBeenCalled();
  });

  it('al aceptar, la da de baja', async () => {
    const usuario = userEvent.setup();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Cisternas />);
    await screen.findAllByText('CL-001');
    await usuario.click(screen.getByRole('button', { name: /Dar de baja/ }));
    await waitFor(() => expect(api.desactivar).toHaveBeenCalledWith('/cisternas/7'));
  });
});
