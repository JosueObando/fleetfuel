import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Viajes from './page';
import { ErrorApi } from '@/api/cliente';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: {
    listar: jest.fn(), obtener: jest.fn(), crear: jest.fn(), actualizar: jest.fn(), desactivar: jest.fn(),
  } };
});
const { api } = jest.requireMock('@/api/cliente') as {
  api: Record<'listar' | 'obtener' | 'crear' | 'actualizar' | 'desactivar', jest.Mock>;
};

/*
 * La pantalla de viajes: donde se arma el viaje, se le asigna carga y se
 * autoriza la salida.
 *
 * Lo que se fija aquí es el §7 llevado a la interfaz: AUTORIZAR es una acción
 * aparte, con su botón propio, y no una transición más del desplegable de
 * estados. Si se mezclara, quien planifica podría dejar salir el camión con la
 * misma pulsación con que lo programa, y el control antifraude —quien arma no
 * autoriza— se quedaría sólo en los permisos del servidor.
 */

const LISTA = [{ id: '1', codigoViaje: 'V-001', estado: 'borrador', conductor: 'Ana' }];
const programado = (extra: Record<string, unknown> = {}) => ({
  id: '1', codigoViaje: 'V-001', estado: 'programado',
  transicionesPosibles: ['autorizado', 'borrador', 'cancelado'],
  ordenes: [], planCarga: [{ id: 'p1', compartimento: 1, volumenPlanificado: 3000 }],
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  api.listar.mockResolvedValue([]);
  api.listar.mockImplementation((r: string) => Promise.resolve(r === '/viajes' ? LISTA : []));
  api.obtener.mockResolvedValue(programado());
  api.crear.mockResolvedValue({ id: '1' });
  api.actualizar.mockResolvedValue({});
  api.desactivar.mockResolvedValue(undefined);
});

const abrirViaje = async (usuario: ReturnType<typeof userEvent.setup>) => {
  await screen.findAllByText('V-001');
  await usuario.click(screen.getAllByText('V-001')[0]);
  await waitFor(() => expect(api.obtener).toHaveBeenCalledWith('/viajes/1'));
};

describe('autorizar es una acción aparte', () => {
  it('sólo aparece cuando el viaje está programado', async () => {
    const usuario = userEvent.setup();
    render(<Viajes />);
    await abrirViaje(usuario);
    expect(await screen.findByRole('button', { name: 'Autorizar' })).toBeInTheDocument();
  });

  it('con el viaje en borrador NO se ofrece', async () => {
    const usuario = userEvent.setup();
    api.obtener.mockResolvedValue(programado({ estado: 'borrador', transicionesPosibles: ['programado'] }));
    render(<Viajes />);
    await abrirViaje(usuario);
    await screen.findByRole('button', { name: 'programado' });
    expect(screen.queryByRole('button', { name: 'Autorizar' })).not.toBeInTheDocument();
  });

  it('usa su endpoint propio, no la transición de estado', async () => {
    // Es lo que hace que el permiso `viajes:autorizar` signifique algo: si
    // fuera un PATCH de estado más, bastaría `viajes:actualizar`.
    const usuario = userEvent.setup();
    render(<Viajes />);
    await abrirViaje(usuario);
    await usuario.click(await screen.findByRole('button', { name: 'Autorizar' }));
    await waitFor(() => expect(api.crear).toHaveBeenCalledWith('/viajes/1/autorizar', {}));
  });

  it('un 403 del servidor se muestra, no se traga', async () => {
    // Es exactamente lo que le pasa a un Planificador de flota: la API
    // responde 403 y la persona tiene que entender por qué.
    const usuario = userEvent.setup();
    api.crear.mockRejectedValue(new ErrorApi(403, 'Permisos insuficientes. Faltan: viajes:autorizar'));
    render(<Viajes />);
    await abrirViaje(usuario);
    await usuario.click(await screen.findByRole('button', { name: 'Autorizar' }));
    expect(await screen.findByText(/Faltan: viajes:autorizar/)).toBeInTheDocument();
  });
});

describe('las transiciones vienen del servidor', () => {
  it('se ofrecen exactamente las que él declara', async () => {
    // No hay una copia de la máquina de estados en el frontend: dos copias se
    // desincronizan y la interfaz acaba ofreciendo saltos que el servidor
    // rechaza.
    const usuario = userEvent.setup();
    render(<Viajes />);
    await abrirViaje(usuario);
    for (const e of ['autorizado', 'borrador', 'cancelado']) {
      expect(await screen.findByRole('button', { name: e })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'cerrado' })).not.toBeInTheDocument();
  });

  it('cancelar pide motivo, y cancelarlo cancela la acción', async () => {
    const usuario = userEvent.setup();
    jest.spyOn(window, 'prompt').mockReturnValue(null);
    render(<Viajes />);
    await abrirViaje(usuario);
    await usuario.click(await screen.findByRole('button', { name: 'cancelado' }));
    expect(api.actualizar).not.toHaveBeenCalled();
  });

  it('con motivo, lo manda junto al estado', async () => {
    const usuario = userEvent.setup();
    jest.spyOn(window, 'prompt').mockReturnValue('Avería del cabezal');
    render(<Viajes />);
    await abrirViaje(usuario);
    await usuario.click(await screen.findByRole('button', { name: 'cancelado' }));
    await waitFor(() => expect(api.actualizar).toHaveBeenCalledWith(
      '/viajes/1/estado', { estado: 'cancelado', motivo: 'Avería del cabezal' }));
  });

  it('las transiciones normales NO piden motivo', async () => {
    const usuario = userEvent.setup();
    const preguntar = jest.spyOn(window, 'prompt');
    render(<Viajes />);
    await abrirViaje(usuario);
    await usuario.click(await screen.findByRole('button', { name: 'borrador' }));
    await waitFor(() => expect(api.actualizar).toHaveBeenCalled());
    expect(preguntar).not.toHaveBeenCalled();
  });
});

describe('el plan de carga', () => {
  it('sin plan, avisa de que el viaje NO podrá autorizarse', async () => {
    // Decirlo aquí ahorra descubrirlo al pulsar «Autorizar» y recibir un 409.
    const usuario = userEvent.setup();
    api.obtener.mockResolvedValue(programado({ planCarga: [] }));
    render(<Viajes />);
    await abrirViaje(usuario);
    expect(await screen.findByText(/no puede autorizarse así/i)).toBeInTheDocument();
  });

  it('con plan, no aparece ese aviso', async () => {
    const usuario = userEvent.setup();
    render(<Viajes />);
    await abrirViaje(usuario);
    await screen.findByRole('button', { name: 'Autorizar' });
    expect(screen.queryByText(/no puede autorizarse así/i)).not.toBeInTheDocument();
  });
});

describe('crear un viaje', () => {
  it('la fecha viaja en ISO, no como la escribió el navegador', async () => {
    // El input `date` da `YYYY-MM-DD` y la API espera un instante completo:
    // sin la conversión, la ocupación de cisterna y conductor se calcularía
    // contra una fecha que el servidor interpreta a su manera.
    const usuario = userEvent.setup();
    render(<Viajes />);
    await screen.findAllByText('V-001');
    await usuario.click(screen.getByRole('button', { name: /Nuevo/ }));
    await usuario.type(screen.getByLabelText(/Código del viaje/), 'V-999');
    await usuario.type(screen.getByLabelText(/Programado para/), '2027-05-01');
    await usuario.click(screen.getByRole('button', { name: /Crear viaje|Crear/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalledWith('/viajes', expect.anything()));
    const cuerpo = api.crear.mock.calls[0][1] as { codigoViaje: string; fechaProgramada: string };
    expect(cuerpo.codigoViaje).toBe('V-999');
    expect(cuerpo.fechaProgramada).toMatch(/^2027-05-01T/);
  });

  it('los opcionales vacíos no viajan', async () => {
    const usuario = userEvent.setup();
    render(<Viajes />);
    await screen.findAllByText('V-001');
    await usuario.click(screen.getByRole('button', { name: /Nuevo/ }));
    await usuario.type(screen.getByLabelText(/Código del viaje/), 'V-998');
    await usuario.type(screen.getByLabelText(/Programado para/), '2027-05-01');
    await usuario.click(screen.getByRole('button', { name: /Crear viaje|Crear/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalled());
    expect(Object.keys(api.crear.mock.calls[0][1] as object).sort())
      .toEqual(['codigoViaje', 'fechaProgramada']);
  });

  it('y lo que SÍ se elige en los opcionales, viaja', async () => {
    // Sin esta mitad, «los vacíos no viajan» sigue en verde si la cisterna deja
    // de mandarse: el viaje se crea SIN cisterna, y la exclusión del §5.1 —que
    // es lo que impide doble reserva— no tiene nada contra lo que chocar.
    const usuario = userEvent.setup();
    api.listar.mockImplementation((r: string) => Promise.resolve(
      r === '/viajes' ? LISTA
      : r === '/cisternas' ? [{ id: '3', placa: 'CT-300' }]
      : r === '/conductores' ? [{ id: '7', nombreCompleto: 'Ana Pérez' }] : []));
    render(<Viajes />);
    await screen.findAllByText('V-001');
    await usuario.click(screen.getByRole('button', { name: /Nuevo/ }));
    await usuario.type(screen.getByLabelText(/Código del viaje/), 'V-996');
    await usuario.type(screen.getByLabelText(/Programado para/), '2027-05-01');
    await usuario.type(screen.getByLabelText(/Fin previsto/), '2027-05-02');
    await usuario.selectOptions(await screen.findByRole('combobox', { name: /Cisterna/ }), '3');
    await usuario.selectOptions(await screen.findByRole('combobox', { name: /Conductor/ }), '7');
    await usuario.click(screen.getByRole('button', { name: /Crear viaje|Crear/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalled());
    const cuerpo = api.crear.mock.calls[0][1] as Record<string, string>;
    expect(cuerpo).toMatchObject({ cisternaId: '3', conductorId: '7' });
    // El fin también en ISO, por el mismo motivo que el inicio.
    expect(cuerpo.fechaFin).toMatch(/^2027-05-02T/);
  });

  it('un choque de ocupación se enseña con el mensaje del servidor', async () => {
    const usuario = userEvent.setup();
    api.crear.mockRejectedValue(
      new ErrorApi(409, 'La cisterna ya tiene otro viaje que se superpone en esas fechas'));
    render(<Viajes />);
    await screen.findAllByText('V-001');
    await usuario.click(screen.getByRole('button', { name: /Nuevo/ }));
    await usuario.type(screen.getByLabelText(/Código del viaje/), 'V-997');
    await usuario.type(screen.getByLabelText(/Programado para/), '2027-05-01');
    await usuario.click(screen.getByRole('button', { name: /Crear viaje|Crear/ }));

    expect(await screen.findByText(/ya tiene otro viaje que se superpone/)).toBeInTheDocument();
  });
});

describe('la lista', () => {
  it('sin viajes no deja la pantalla en blanco', async () => {
    api.listar.mockResolvedValue([]);
    render(<Viajes />);
    expect(await screen.findByRole('heading', { name: 'Viajes' })).toBeInTheDocument();
  });

  it('si un viaje no se puede abrir, se dice en vez de dejar el detalle vacío', async () => {
    const usuario = userEvent.setup();
    api.obtener.mockRejectedValue(new ErrorApi(404, 'Ese viaje ya no existe'));
    render(<Viajes />);
    await screen.findAllByText('V-001');
    await usuario.click(screen.getAllByText('V-001')[0]);
    expect(await screen.findByText('Ese viaje ya no existe')).toBeInTheDocument();
  });

  it('un fallo al cargar se explica', async () => {
    api.listar.mockImplementation((r: string) =>
      r === '/viajes' ? Promise.reject(new ErrorApi(403, 'Permisos insuficientes. Faltan: viajes:leer'))
                      : Promise.resolve([]));
    render(<Viajes />);
    expect(await screen.findByText(/Faltan: viajes:leer/)).toBeInTheDocument();
  });
});

describe('asignar órdenes y armar el plan de carga', () => {
  const conOrden = () => ({
    ...programado(),
    estado: 'borrador',
    transicionesPosibles: ['programado', 'cancelado'],
    cisternaId: '3',
    ordenes: [{ id: 'vo1', ordenId: '5', secuencia: 1, estacion: 'Vía España', estado: 'asignada' }],
    planCarga: [{ id: 'p1', compartimentoId: '11', compartimento: 1,
                  capacidadCalibrada: '4980', volumenPlanificado: '3000' }],
  });

  it('asignar una orden validada usa la ruta del viaje', async () => {
    const usuario = userEvent.setup();
    api.obtener.mockImplementation(async (r: string) =>
      r.startsWith('/viajes') ? conOrden()
      : { id: '5', numeroOrdenExterna: 'EXT-1', detalles: [{ id: 'd1', producto: 'Diésel' }] });
    api.listar.mockImplementation((r: string) =>
      Promise.resolve(r === '/viajes' ? LISTA
        : r === '/ordenes?estado=validada' ? [{ id: '9', numeroOrdenExterna: 'EXT-9' }] : []));
    render(<Viajes />);
    await abrirViaje(usuario);

    // El botón nace deshabilitado hasta elegir la orden: sin eso se asignaría
    // una orden vacía y el servidor respondería un 400 que no explica nada.
    const boton = await screen.findByRole('button', { name: /Asignar orden/ });
    expect(boton).toBeDisabled();

    await usuario.selectOptions(screen.getByRole('combobox', { name: /Orden validada/ }), '9');
    expect(screen.getByRole('button', { name: /Asignar orden/ })).not.toBeDisabled();
    await usuario.click(screen.getByRole('button', { name: /Asignar orden/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalledWith(
      '/viajes/1/ordenes', { ordenId: '9', secuenciaEntrega: 1 }));
  }, 30_000);

  it('una orden que ya va en el viaje no se ofrece otra vez, y sin ninguna libre no hay control', async () => {
    // La única validada es la 5, que ya está asignada. Ofrecerla invitaría a un
    // 409; dejar el desplegable vacío con su botón, a pulsar algo que no hace
    // nada.
    const usuario = userEvent.setup();
    api.obtener.mockImplementation(async (r: string) =>
      r.startsWith('/viajes') ? conOrden()
      : { id: '5', numeroOrdenExterna: 'EXT-1', detalles: [{ id: 'd1', producto: 'Diésel' }] });
    api.listar.mockImplementation((r: string) =>
      Promise.resolve(r === '/viajes' ? LISTA
        : r === '/ordenes?estado=validada' ? [{ id: '5', numeroOrdenExterna: 'EXT-1' }] : []));
    render(<Viajes />);
    await abrirViaje(usuario);

    await screen.findByRole('button', { name: /Quitar/ });
    expect(screen.queryByRole('combobox', { name: /Orden validada/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Asignar orden/ })).not.toBeInTheDocument();
  }, 30_000);

  it('quitar una línea del plan usa su propia ruta', async () => {
    const usuario = userEvent.setup();
    api.obtener.mockImplementation(async (r: string) =>
      r.startsWith('/viajes') ? conOrden()
      : { id: '5', numeroOrdenExterna: 'EXT-1', detalles: [{ id: 'd1', producto: 'Diésel' }] });
    render(<Viajes />);
    await abrirViaje(usuario);

    const quitar = await screen.findByRole('button', { name: /Quitar/ });
    await usuario.click(quitar);
    await waitFor(() => expect(api.desactivar).toHaveBeenCalledWith('/viajes/1/plan-carga/p1'));
  }, 30_000);

  it('el plan de carga muestra el volumen contra lo calibrado', async () => {
    // Es la comprobación que hace un operador de un vistazo: si lo planificado
    // supera lo calibrado, la carga no cabe.
    const usuario = userEvent.setup();
    api.obtener.mockImplementation(async (r: string) =>
      r.startsWith('/viajes') ? conOrden()
      : { id: '5', numeroOrdenExterna: 'EXT-1', detalles: [] });
    render(<Viajes />);
    await abrirViaje(usuario);
    expect(await screen.findByText(/3000|3,000/)).toBeInTheDocument();
  }, 30_000);
});
