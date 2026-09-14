import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Ordenes from './page';
import { ErrorApi } from '@/api/cliente';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { listar: jest.fn(), obtener: jest.fn(), crear: jest.fn(), actualizar: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as {
  api: Record<'listar' | 'obtener' | 'crear' | 'actualizar', jest.Mock>;
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
  admiteEdicion: true,
}];

/* `GET /ordenes/:id` con la forma de `CAMPOS`: `fecha_requerida` es `date`
   y las ventanas `timestamptz`. `admiteEdicion` lo calcula la API. */
const DETALLE = {
  ...ORDENES[0], fechaRequerida: '2026-10-01T05:00:00.000Z',
  ventanaInicio: '2026-10-01T13:00:00.000Z', ventanaFin: null,
  prioridad: 'normal', observaciones: null, admiteEdicion: true,
  detalles: [{ id: '50', productoId: '9', producto: 'Gasolina 95', volumenSolicitado: '4000.00' }],
};

const listarPor = (r: string) =>
  r === '/ordenes' ? ORDENES : r === '/clientes' ? CLIENTES
  : r === '/estaciones' ? ESTACIONES : PRODUCTOS;

beforeEach(() => {
  jest.clearAllMocks();
  api.listar.mockImplementation((r: string) => Promise.resolve(listarPor(r)));
  api.crear.mockResolvedValue({ id: '6' });
  api.actualizar.mockResolvedValue({ id: '5' });
  api.obtener.mockResolvedValue(DETALLE);
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

  it('una orden sin salidas lo dice con una palabra, en vez de dejar la celda vacía', async () => {
    // Una celda de acciones vacía se lee como «no ha cargado» o «no tengo
    // permiso»; «final» dice que no hay nada más que hacer con ella.
    api.listar.mockImplementation((r: string) => Promise.resolve(r === '/ordenes'
      ? [{ ...ORDENES[0], estado: 'entregada', transicionesPosibles: [], admiteEdicion: false }] : listarPor(r)));
    render(<Ordenes />);
    const fila = (await screen.findByText('EXT-1')).closest('tr')!;
    expect(within(fila).getByText('final')).toBeInTheDocument();
    expect(within(fila).queryAllByRole('button')).toHaveLength(0);
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

  it('y lo que SÍ se escribe en los opcionales, viaja', async () => {
    // La mitad que faltaba. «Los vacíos no viajan» sigue en verde si alguien
    // borra la línea que manda el campo: el usuario lo escribe, la orden se
    // crea, y el número de orden del cliente no llega nunca.
    const usuario = userEvent.setup();
    render(<Ordenes />);
    await abrir(usuario);

    await usuario.selectOptions(screen.getByRole('combobox', { name: /Cliente/ }), '1');
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/estaciones'));
    await usuario.selectOptions(screen.getByRole('combobox', { name: /Estación/ }), '10');
    await usuario.type(screen.getByLabelText(/orden externa/), 'OC-77');
    await usuario.type(screen.getByLabelText(/Fecha requerida/), '2026-10-01');
    await usuario.selectOptions(screen.getByRole('combobox', { name: /Producto/ }), '9');
    await usuario.type(screen.getByLabelText(/^Volumen/), '4000');
    await usuario.type(screen.getByLabelText(/Tolerancia/), '0.5');
    await usuario.click(screen.getByRole('button', { name: /Crear orden/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalled());
    expect(api.crear.mock.calls[0][1]).toEqual({
      clienteId: '1', estacionId: '10', prioridad: 'normal',
      numeroOrdenExterna: 'OC-77', fechaRequerida: '2026-10-01',
      detalles: [{ productoId: '9', volumenSolicitado: 4000, tolerancia: 0.5 }],
    });
  });

  it('si el servidor rechaza el alta, el formulario sigue abierto con lo escrito', async () => {
    const usuario = userEvent.setup();
    api.crear.mockRejectedValue(new ErrorApi(400, 'La estación no pertenece al cliente'));
    render(<Ordenes />);
    await abrir(usuario);
    await usuario.selectOptions(screen.getByRole('combobox', { name: /Cliente/ }), '1');
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/estaciones'));
    await usuario.selectOptions(screen.getByRole('combobox', { name: /Estación/ }), '10');
    await usuario.type(screen.getByLabelText(/orden externa/), 'OC-78');
    await usuario.selectOptions(screen.getByRole('combobox', { name: /Producto/ }), '9');
    await usuario.type(screen.getByLabelText(/^Volumen/), '4000');
    await usuario.click(screen.getByRole('button', { name: /Crear orden/ }));

    expect(await screen.findByText('La estación no pertenece al cliente')).toBeInTheDocument();
    expect(screen.getByLabelText(/orden externa/)).toHaveValue('OC-78');
    expect(screen.getByRole('button', { name: /Crear orden/ })).toBeEnabled();
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

describe('editar la programación de una orden', () => {
  /* `PATCH /ordenes/:id` no tenía pantalla: mover la fecha o la ventana de
     entrega que pide el cliente obligaba a cancelar la orden y rehacerla. */

  const abrirEdicion = async (usuario: ReturnType<typeof userEvent.setup>) => {
    await screen.findAllByText('EXT-1');
    await usuario.click(screen.getByRole('button', { name: 'Editar EXT-1' }));
    return screen.findByRole('form', { name: 'Editar la orden EXT-1' });
  };

  const reescribir = async (usuario: ReturnType<typeof userEvent.setup>, campo: HTMLElement, texto: string) => {
    await usuario.clear(campo);
    if (texto) await usuario.type(campo, texto);
  };

  it('sólo se ofrece en las órdenes que la API declara editables', async () => {
    // La lista de estados editables vive en el servidor y llega como
    // `admiteEdicion`: copiarla aquí sería una segunda definición que diverge.
    api.listar.mockImplementation((r: string) => Promise.resolve(r === '/ordenes'
      ? [{ ...ORDENES[0], admiteEdicion: true },
         { ...ORDENES[0], id: '6', numeroOrdenExterna: 'EXT-2', estado: 'planificada', admiteEdicion: false }]
      : listarPor(r)));
    render(<Ordenes />);
    await screen.findAllByText('EXT-2');
    expect(screen.getByRole('button', { name: 'Editar EXT-1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar EXT-2' })).not.toBeInTheDocument();
  });

  it('abre con la programación ACTUAL, leída al abrir y en hora local', async () => {
    const usuario = userEvent.setup();
    render(<Ordenes />);
    const form = await abrirEdicion(usuario);

    expect(api.obtener).toHaveBeenCalledWith('/ordenes/5');
    expect(within(form).getByRole('combobox', { name: 'Prioridad' })).toHaveValue('normal');
    expect(within(form).getByLabelText(/Fecha requerida/)).toHaveValue('2026-10-01');
    // 13:00 UTC son las 8:00 en Panamá: es la hora que dio el cliente.
    expect(within(form).getByLabelText(/Inicio de la ventana/)).toHaveValue('2026-10-01T08:00');
    expect(within(form).getByLabelText(/Fin de la ventana/)).toHaveValue('');
  });

  it('manda SÓLO lo que cambió', async () => {
    const usuario = userEvent.setup();
    render(<Ordenes />);
    const form = await abrirEdicion(usuario);

    await usuario.selectOptions(within(form).getByRole('combobox', { name: 'Prioridad' }), 'urgente');
    await usuario.click(within(form).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(api.actualizar).toHaveBeenCalled());
    expect(api.actualizar.mock.calls[0]).toEqual(['/ordenes/5', { prioridad: 'urgente' }]);
  });

  it('y lo que se cambia viaja, con la ventana como instante', async () => {
    const usuario = userEvent.setup();
    render(<Ordenes />);
    const form = await abrirEdicion(usuario);

    await reescribir(usuario, within(form).getByLabelText(/Fecha requerida/), '2026-10-02');
    await reescribir(usuario, within(form).getByLabelText(/Fin de la ventana/), '2026-10-01T14:00');
    await reescribir(usuario, within(form).getByLabelText(/Observaciones/), 'Llamar antes de llegar');
    await usuario.click(within(form).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(api.actualizar).toHaveBeenCalled());
    expect(api.actualizar.mock.calls[0][1]).toEqual({
      fechaRequerida: '2026-10-02',
      ventanaFin: '2026-10-01T19:00:00.000Z',
      observaciones: 'Llamar antes de llegar',
    });
  });

  it('vaciar la fecha requerida la QUITA', async () => {
    const usuario = userEvent.setup();
    render(<Ordenes />);
    const form = await abrirEdicion(usuario);

    await reescribir(usuario, within(form).getByLabelText(/Fecha requerida/), '');
    await usuario.click(within(form).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(api.actualizar).toHaveBeenCalled());
    expect(api.actualizar.mock.calls[0][1]).toEqual({ fechaRequerida: null });
  });

  it('una ventana que termina antes de empezar avisa y BLOQUEA', async () => {
    const usuario = userEvent.setup();
    render(<Ordenes />);
    const form = await abrirEdicion(usuario);

    await reescribir(usuario, within(form).getByLabelText(/Fin de la ventana/), '2026-10-01T07:00');
    expect(within(form).getByText('La ventana termina antes de empezar.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('terminar a la MISMA hora que empieza tampoco vale: la base pide «después»', async () => {
    const usuario = userEvent.setup();
    render(<Ordenes />);
    const form = await abrirEdicion(usuario);

    await reescribir(usuario, within(form).getByLabelText(/Fin de la ventana/), '2026-10-01T08:00');
    expect(within(form).getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('una ventana abierta por un lado no se juzga', async () => {
    // Sin fin, no hay nada con qué comparar: marcarla sería gritarle a quien
    // aún no ha terminado de escribir.
    const usuario = userEvent.setup();
    render(<Ordenes />);
    const form = await abrirEdicion(usuario);

    await reescribir(usuario, within(form).getByLabelText(/Inicio de la ventana/), '2026-10-01T09:00');
    expect(within(form).queryByText('La ventana termina antes de empezar.')).not.toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Guardar cambios' })).not.toBeDisabled();
  });

  it('sin cambios no hay nada que guardar, y la prioridad no se puede vaciar', async () => {
    const usuario = userEvent.setup();
    render(<Ordenes />);
    const form = await abrirEdicion(usuario);
    expect(within(form).getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(within(form).getByRole('combobox', { name: 'Prioridad' })).toBeRequired();
  });

  it('si el servidor rechaza, el motivo se ve y el formulario sigue abierto', async () => {
    // El caso real: otra persona planificó la orden mientras esta la editaba.
    api.actualizar.mockRejectedValue(
      new ErrorApi(409, 'Una orden en estado "planificada" ya no admite cambios de programación'));
    const usuario = userEvent.setup();
    render(<Ordenes />);
    const form = await abrirEdicion(usuario);

    await usuario.selectOptions(within(form).getByRole('combobox', { name: 'Prioridad' }), 'alta');
    await usuario.click(within(form).getByRole('button', { name: 'Guardar cambios' }));

    expect(await within(form).findByText(/ya no admite cambios de programación/)).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Editar la orden EXT-1' })).toBeInTheDocument();
  });

  it('al guardar, cierra y recarga la lista', async () => {
    const usuario = userEvent.setup();
    render(<Ordenes />);
    const form = await abrirEdicion(usuario);

    await usuario.selectOptions(within(form).getByRole('combobox', { name: 'Prioridad' }), 'alta');
    await usuario.click(within(form).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Editar la orden EXT-1' })).not.toBeInTheDocument());
    expect(api.listar.mock.calls.filter(c => c[0] === '/ordenes')).toHaveLength(2);
  });

  it('cancelar cierra sin mandar nada', async () => {
    const usuario = userEvent.setup();
    render(<Ordenes />);
    const form = await abrirEdicion(usuario);
    await usuario.click(within(form).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('form', { name: 'Editar la orden EXT-1' })).not.toBeInTheDocument();
    expect(api.actualizar).not.toHaveBeenCalled();
  });

  it('nunca hay dos formularios a la vez', async () => {
    const usuario = userEvent.setup();
    render(<Ordenes />);
    await screen.findAllByText('EXT-1');
    await usuario.click(screen.getByRole('button', { name: /Nueva orden/ }));
    await usuario.click(screen.getByRole('button', { name: 'Editar EXT-1' }));
    await screen.findByRole('form', { name: 'Editar la orden EXT-1' });
    expect(screen.queryByRole('button', { name: 'Crear orden' })).not.toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: /Nueva orden/ }));
    expect(screen.queryByRole('form', { name: 'Editar la orden EXT-1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear orden' })).toBeInTheDocument();
  });

  it('si no se puede leer la orden, se dice en vez de abrir un formulario vacío', async () => {
    api.obtener.mockRejectedValue(new ErrorApi(404, 'Orden no encontrada'));
    const usuario = userEvent.setup();
    render(<Ordenes />);
    await screen.findAllByText('EXT-1');
    await usuario.click(screen.getByRole('button', { name: 'Editar EXT-1' }));
    expect(await screen.findByText('Orden no encontrada')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: /Editar la orden/ })).not.toBeInTheDocument();
  });
});
