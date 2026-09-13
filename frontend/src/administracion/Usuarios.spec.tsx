import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Usuarios } from './Usuarios';
import { ErrorApi } from '@/api/cliente';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return {
    ...real,
    api: { listar: jest.fn(), obtener: jest.fn(), crear: jest.fn(), actualizar: jest.fn(), desactivar: jest.fn() },
  };
});
const { api } = jest.requireMock('@/api/cliente') as {
  api: { listar: jest.Mock; crear: jest.Mock; actualizar: jest.Mock };
};

/*
 * §5 del PRD · Usuarios y roles.
 *
 * La API existía desde la Fase 0.3 y NINGUNA pantalla la llamaba: dar de alta a
 * una persona exigía entrar por curl. La compuerta pendiente del plan es
 * «producción con usuarios reales», así que esto no era una carencia de confort.
 *
 * QUÉ SE PRUEBA AQUÍ, Y QUÉ NO
 *
 * No se prueba que la tabla pinte celdas. Se prueba lo que esta pantalla decide
 * y la API no puede decidir por ella: que el MFA de cada cuenta sea VISIBLE, y
 * que suspender exija un motivo antes de salir del navegador.
 */

const USUARIOS = [
  { id: 'u1', nombre: 'Ana Pérez', correo: 'ana@fleetfuel.jop.lat', estado: 'activo',
    mfaHabilitado: true,  ultimoAccesoEn: '2026-09-11T14:03:00Z', roles: ['Administrador'] },
  { id: 'u2', nombre: 'Luis Gómez', correo: 'luis@fleetfuel.jop.lat', estado: 'activo',
    mfaHabilitado: false, ultimoAccesoEn: null, roles: ['Despachador'] },
  { id: 'u3', nombre: 'Mará Ruiz', correo: 'mara@fleetfuel.jop.lat', estado: 'suspendido',
    mfaHabilitado: true,  ultimoAccesoEn: null, roles: [] },
];
const ROLES = [
  { id: 'r1', nombre: 'Administrador' }, { id: 'r2', nombre: 'Despachador' },
];

const filaDe = (nombre: string) =>
  screen.getByRole('row', { name: new RegExp(nombre) });

beforeEach(() => {
  jest.clearAllMocks();
  api.listar.mockImplementation((ruta: string) =>
    Promise.resolve(ruta === '/usuarios' ? USUARIOS : ROLES));
});

describe('la lista', () => {
  it('enseña a cada persona con su correo y sus roles', async () => {
    render(<Usuarios />);
    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
    expect(within(filaDe('Ana Pérez')).getByText(/ana@fleetfuel/)).toBeInTheDocument();
    expect(within(filaDe('Ana Pérez')).getByText(/Administrador/)).toBeInTheDocument();
  });

  it('dice QUIÉN no tiene segundo factor, y lo dice con palabras', async () => {
    /* §21: una cuenta sin MFA en un sistema cuyo riesgo principal es el fraude
       interno es el agujero, no un detalle de configuración. Un icono o un
       color no bastan: quien audita necesita poder buscar el texto, y quien no
       distingue colores necesita leerlo. */
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');
    expect(within(filaDe('Luis Gómez')).getByText(/sin MFA/i)).toBeInTheDocument();
    expect(within(filaDe('Ana Pérez')).queryByText(/sin MFA/i)).not.toBeInTheDocument();
  });

  it('quien nunca entró no aparece como si hubiera entrado', async () => {
    // `ultimoAccesoEn: null` pintado como cadena vacía se lee como un dato que
    // falta por un fallo, no como «esta cuenta no se ha usado nunca».
    render(<Usuarios />);
    await screen.findByText('Luis Gómez');
    expect(within(filaDe('Luis Gómez')).getByText(/nunca/i)).toBeInTheDocument();
  });

  it('si la lista no carga, lo dice', async () => {
    api.listar.mockRejectedValue(new ErrorApi(403, 'No tienes permiso para ver usuarios'));
    render(<Usuarios />);
    expect(await screen.findByText(/No tienes permiso para ver usuarios/)).toBeInTheDocument();
  });
});

describe('dar de alta', () => {
  it('manda nombre, correo, clave y los roles marcados', async () => {
    const usuario = userEvent.setup();
    api.crear.mockResolvedValue({ id: 'u9' });
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');

    await usuario.click(screen.getByRole('button', { name: /Nuevo usuario/ }));
    await usuario.type(screen.getByLabelText(/Nombre/), 'Carlos Díaz');
    await usuario.type(screen.getByLabelText(/Correo/), 'carlos@fleetfuel.jop.lat');
    await usuario.type(screen.getByLabelText(/Clave/), 'ClaveLarga123');
    await usuario.click(screen.getByRole('checkbox', { name: 'Despachador' }));
    await usuario.click(screen.getByRole('button', { name: /Crear usuario/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalledWith('/usuarios', {
      nombre: 'Carlos Díaz',
      correo: 'carlos@fleetfuel.jop.lat',
      clave: 'ClaveLarga123',
      roles: ['Despachador'],
    }));
  });

  it('dice qué clave se acepta ANTES de enviarla', async () => {
    /* El backend exige 12 caracteres con mayúscula, minúscula y dígito. Sin
       decirlo aquí, la primera noticia es un 400 con la clave ya escrita — y a
       la segunda o tercera la gente elige la más corta que cuele. */
    const usuario = userEvent.setup();
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');
    await usuario.click(screen.getByRole('button', { name: /Nuevo usuario/ }));
    expect(screen.getByText(/12 caracteres/)).toBeInTheDocument();
  });

  it('un correo repetido llega con el mensaje del servidor', async () => {
    const usuario = userEvent.setup();
    api.crear.mockRejectedValue(new ErrorApi(409, 'Ya existe un usuario con ese correo'));
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');

    await usuario.click(screen.getByRole('button', { name: /Nuevo usuario/ }));
    await usuario.type(screen.getByLabelText(/Nombre/), 'Ana Bis');
    await usuario.type(screen.getByLabelText(/Correo/), 'ana@fleetfuel.jop.lat');
    await usuario.type(screen.getByLabelText(/Clave/), 'ClaveLarga123');
    await usuario.click(screen.getByRole('button', { name: /Crear usuario/ }));

    expect(await screen.findByText(/Ya existe un usuario con ese correo/)).toBeInTheDocument();
  });

  it('sin roles marcados NO manda un array vacío', async () => {
    // `roles: []` y «sin roles» son lo mismo para el resultado, pero el primero
    // afirma una decisión que nadie tomó. El DTO lo declara opcional.
    const usuario = userEvent.setup();
    api.crear.mockResolvedValue({ id: 'u9' });
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');

    await usuario.click(screen.getByRole('button', { name: /Nuevo usuario/ }));
    await usuario.type(screen.getByLabelText(/Nombre/), 'Sin Rol');
    await usuario.type(screen.getByLabelText(/Correo/), 'sinrol@fleetfuel.jop.lat');
    await usuario.type(screen.getByLabelText(/Clave/), 'ClaveLarga123');
    await usuario.click(screen.getByRole('button', { name: /Crear usuario/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalled());
    expect(api.crear.mock.calls[0][1]).not.toHaveProperty('roles');
  });
});

describe('suspender', () => {
  it('exige el motivo: sin él no sale ni una petición', async () => {
    /* §21 pide el motivo del cambio, no sólo el cambio, y el backend lo exige
       con un mínimo de 10 caracteres. Dejar que salga la petición para que el
       servidor la rechace convierte un requisito de auditoría en un error de
       validación, y se lee como un estorbo del formulario. */
    const usuario = userEvent.setup();
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');

    await usuario.click(within(filaDe('Luis Gómez')).getByRole('button', { name: /Suspender/ }));
    await usuario.click(screen.getByRole('button', { name: /Confirmar suspensión/ }));

    // Vacío lo para el `required` del navegador: el formulario ni se envía.
    expect(api.actualizar).not.toHaveBeenCalled();
  });

  it('y un motivo CORTO tampoco sale: ahí es la pantalla quien lo para', async () => {
    /* Dos frenos distintos, y hay que probar los dos por separado. Con el campo
       vacío el `required` del navegador bloquea el submit y el código de la
       pantalla NO LLEGA A CORRER; sólo un motivo corto —pero escrito— ejercita
       la comprobación de las 10 letras.

       La versión anterior de esta prueba afirmaba `findByText(/motivo/i)` con
       el campo vacío, y casaba con la ETIQUETA «Motivo» del propio campo: verde
       permanente sobre una validación que nunca se ejecutaba. Lo delató la
       cobertura, no el resultado. */
    const usuario = userEvent.setup();
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');

    await usuario.click(within(filaDe('Luis Gómez')).getByRole('button', { name: /Suspender/ }));
    await usuario.type(screen.getByLabelText(/Motivo/), 'Se fue');
    await usuario.click(screen.getByRole('button', { name: /Confirmar suspensión/ }));

    expect(await screen.findByText(/mínimo 10 caracteres/i)).toBeInTheDocument();
    expect(screen.getByText(/Queda auditado/i)).toBeInTheDocument();
    expect(api.actualizar).not.toHaveBeenCalled();
  });

  it('con motivo, lo manda al endpoint del usuario correcto', async () => {
    const usuario = userEvent.setup();
    api.actualizar.mockResolvedValue({ id: 'u2', estado: 'suspendido' });
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');

    await usuario.click(within(filaDe('Luis Gómez')).getByRole('button', { name: /Suspender/ }));
    await usuario.type(screen.getByLabelText(/Motivo/), 'Dejó la empresa el 2026-09-10');
    await usuario.click(screen.getByRole('button', { name: /Confirmar suspensión/ }));

    await waitFor(() => expect(api.actualizar).toHaveBeenCalledWith(
      '/usuarios/u2/suspender', { motivo: 'Dejó la empresa el 2026-09-10' }));
  });

  it('a quien ya está suspendido no se le ofrece suspender otra vez', async () => {
    render(<Usuarios />);
    await screen.findByText('Mará Ruiz');
    expect(within(filaDe('Mará Ruiz')).queryByRole('button', { name: /Suspender/ }))
      .not.toBeInTheDocument();
  });

  it('tras suspender, la lista se relee', async () => {
    // Sin releer, la fila sigue diciendo «activo» y quien mira cree que falló.
    const usuario = userEvent.setup();
    api.actualizar.mockResolvedValue({ id: 'u2', estado: 'suspendido' });
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');
    const antes = api.listar.mock.calls.filter(c => c[0] === '/usuarios').length;

    await usuario.click(within(filaDe('Luis Gómez')).getByRole('button', { name: /Suspender/ }));
    await usuario.type(screen.getByLabelText(/Motivo/), 'Dejó la empresa el 2026-09-10');
    await usuario.click(screen.getByRole('button', { name: /Confirmar suspensión/ }));

    await waitFor(() => expect(
      api.listar.mock.calls.filter(c => c[0] === '/usuarios').length).toBeGreaterThan(antes));
  });
});

describe('los caminos que no salen bien', () => {
  it('si suspender falla, lo dice y no cierra el formulario', async () => {
    // Cerrarlo dejaría la fila como estaba y a la persona creyendo que ya está.
    const usuario = userEvent.setup();
    api.actualizar.mockRejectedValue(new ErrorApi(409, 'El usuario ya estaba suspendido'));
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');

    await usuario.click(within(filaDe('Luis Gómez')).getByRole('button', { name: /Suspender/ }));
    await usuario.type(screen.getByLabelText(/Motivo/), 'Dejó la empresa el 2026-09-10');
    await usuario.click(screen.getByRole('button', { name: /Confirmar suspensión/ }));

    expect(await screen.findByText(/El usuario ya estaba suspendido/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmar suspensión/ })).toBeInTheDocument();
  });

  it('cancelar la suspensión no manda nada y cierra el formulario', async () => {
    const usuario = userEvent.setup();
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');

    await usuario.click(within(filaDe('Luis Gómez')).getByRole('button', { name: /Suspender/ }));
    await usuario.click(screen.getByRole('button', { name: /^Cancelar$/ }));

    expect(api.actualizar).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Confirmar suspensión/ })).not.toBeInTheDocument();
  });

  it('cancelar el alta tampoco crea a nadie', async () => {
    const usuario = userEvent.setup();
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');

    await usuario.click(screen.getByRole('button', { name: /Nuevo usuario/ }));
    await usuario.type(screen.getByLabelText(/Nombre/), 'Arrepentido');
    await usuario.click(screen.getByRole('button', { name: /^Cancelar$/ }));

    expect(api.crear).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Clave/)).not.toBeInTheDocument();
  });

  it('un alta que falla deja el formulario abierto con lo escrito', async () => {
    /* Vaciarlo obligaría a reescribir nombre, correo y clave por un 400 en un
       solo campo, y a la segunda vez la clave elegida es más corta. */
    const usuario = userEvent.setup();
    api.crear.mockRejectedValue(new ErrorApi(400, 'La clave debe incluir un dígito'));
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');

    await usuario.click(screen.getByRole('button', { name: /Nuevo usuario/ }));
    await usuario.type(screen.getByLabelText(/Nombre/), 'Carlos Díaz');
    await usuario.type(screen.getByLabelText(/Correo/), 'carlos@fleetfuel.jop.lat');
    await usuario.type(screen.getByLabelText(/Clave/), 'ClaveSinDigito');
    await usuario.click(screen.getByRole('button', { name: /Crear usuario/ }));

    expect(await screen.findByText(/La clave debe incluir un dígito/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre/)).toHaveValue('Carlos Díaz');
  });

  it('el teléfono vacío NO se manda', async () => {
    // `telefono: ''` choca contra el `@Length(6, 40)` del DTO por un campo que
    // la persona ni tocó, y el 400 habla de un campo que no está en pantalla.
    const usuario = userEvent.setup();
    api.crear.mockResolvedValue({ id: 'u9' });
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');

    await usuario.click(screen.getByRole('button', { name: /Nuevo usuario/ }));
    await usuario.type(screen.getByLabelText(/Nombre/), 'Sin Teléfono');
    await usuario.type(screen.getByLabelText(/Correo/), 'st@fleetfuel.jop.lat');
    await usuario.type(screen.getByLabelText(/Clave/), 'ClaveLarga123');
    await usuario.click(screen.getByRole('button', { name: /Crear usuario/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalled());
    expect(api.crear.mock.calls[0][1]).not.toHaveProperty('telefono');
  });

  it('y el teléfono escrito SÍ', async () => {
    const usuario = userEvent.setup();
    api.crear.mockResolvedValue({ id: 'u9' });
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');

    await usuario.click(screen.getByRole('button', { name: /Nuevo usuario/ }));
    await usuario.type(screen.getByLabelText(/Nombre/), 'Con Teléfono');
    await usuario.type(screen.getByLabelText(/Correo/), 'ct@fleetfuel.jop.lat');
    await usuario.type(screen.getByLabelText(/Clave/), 'ClaveLarga123');
    await usuario.type(screen.getByLabelText(/Teléfono/), '+507 6000-0000');
    await usuario.click(screen.getByRole('button', { name: /Crear usuario/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalled());
    expect(api.crear.mock.calls[0][1]).toMatchObject({ telefono: '+507 6000-0000' });
  });

  it('si los roles no cargan, el alta sigue siendo posible sin ellos', async () => {
    /* `/roles` exige `roles:leer` y `/usuarios` exige `usuarios:leer`: hay
       repartos donde se tiene el segundo y no el primero. Que la lista de roles
       falle no puede impedir dar de alta a una persona. */
    const usuario = userEvent.setup();
    api.listar.mockImplementation((ruta: string) =>
      ruta === '/usuarios' ? Promise.resolve(USUARIOS)
                           : Promise.reject(new ErrorApi(403, 'Sin permiso')));
    render(<Usuarios />);
    await screen.findByText('Ana Pérez');

    await usuario.click(screen.getByRole('button', { name: /Nuevo usuario/ }));
    expect(screen.getByText(/No hay roles que asignar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear usuario/ })).toBeEnabled();
  });
});
