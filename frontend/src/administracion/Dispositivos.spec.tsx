import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dispositivos } from './Dispositivos';
import { ErrorApi } from '@/api/cliente';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { listar: jest.fn(), actualizar: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as {
  api: { listar: jest.Mock; actualizar: jest.Mock };
};

/*
 * §21 · Los dispositivos con sesión abierta.
 *
 * Revocar es la operación de emergencia del sistema: el equipo robado o el que
 * se queda un empleado que se va. La API existía y no había pantalla, así que
 * la única forma de cortarle el acceso a un aparato era un PATCH por curl — y
 * quien necesita hacer eso lo necesita en ese momento, no cuando encuentre a
 * quien sepa hacerlo.
 *
 * LO QUE ESTA PANTALLA AÑADE SOBRE LA API
 *
 * Enseñar el efecto REAL de la revocación. El backend devuelve
 * `sesionesCortadas` porque revocar es una operación en dos mundos —la marca en
 * Postgres impide futuros logins, el borrado en Redis corta las sesiones ya
 * abiertas—, y saber cuántas se cortaron es la diferencia entre «lo hice» y
 * «funcionó».
 */

const DISPOSITIVOS = [
  { id: 'd1', identificador: 'AND-77', nombre: 'Tablet cabina 1', plataforma: 'android',
    usuario: 'Ana Pérez', ultimoUsoEn: '2026-09-11T14:03:00Z', revocadoEn: null },
  { id: 'd2', identificador: 'IOS-12', nombre: 'iPad supervisión', plataforma: 'ios',
    usuario: 'Luis Gómez', ultimoUsoEn: null, revocadoEn: '2026-09-01T10:00:00Z' },
];

beforeEach(() => {
  jest.clearAllMocks();
  api.listar.mockResolvedValue(DISPOSITIVOS);
  api.actualizar.mockResolvedValue({ id: 'd1', revocado: true, sesionesCortadas: 2 });
});

const filaDe = (t: string) => screen.getByRole('row', { name: new RegExp(t) });

describe('la lista', () => {
  it('enseña de quién es cada aparato', async () => {
    // Un identificador suelto no sirve para decidir: lo que se revoca es «la
    // tablet de Ana», no «AND-77».
    render(<Dispositivos />);
    await screen.findByText('Tablet cabina 1');
    expect(filaDe('Tablet cabina 1')).toHaveTextContent('Ana Pérez');
  });

  it('el que nunca se usó no parece haberse usado', async () => {
    render(<Dispositivos />);
    await screen.findByText('iPad supervisión');
    expect(filaDe('iPad supervisión')).toHaveTextContent(/nunca/i);
  });

  it('distingue el revocado del activo, con palabras', async () => {
    render(<Dispositivos />);
    await screen.findByText('Tablet cabina 1');
    expect(filaDe('iPad supervisión')).toHaveTextContent(/revocado/i);
    expect(filaDe('Tablet cabina 1')).toHaveTextContent(/activo/i);
  });

  it('si no se puede listar, lo dice', async () => {
    api.listar.mockRejectedValue(new ErrorApi(403, 'No tienes permiso'));
    render(<Dispositivos />);
    expect(await screen.findByText(/No tienes permiso/)).toBeInTheDocument();
  });
});

describe('revocar', () => {
  it('exige un motivo antes de salir del navegador', async () => {
    // §21: el motivo del cambio, no sólo el cambio. Y esta operación se hace
    // con prisa, que es justo cuando nadie escribe el porqué si no se le pide.
    const usuario = userEvent.setup();
    render(<Dispositivos />);
    await screen.findByText('Tablet cabina 1');

    await usuario.click(within(filaDe('Tablet cabina 1')).getByRole('button', { name: /Revocar/ }));
    await usuario.type(screen.getByLabelText(/Motivo/), 'robo');
    await usuario.click(screen.getByRole('button', { name: /Confirmar revocación/ }));

    expect(api.actualizar).not.toHaveBeenCalled();
    expect(await screen.findByText(/al menos 10/i)).toBeInTheDocument();
  });

  it('con motivo, lo manda al dispositivo correcto', async () => {
    const usuario = userEvent.setup();
    render(<Dispositivos />);
    await screen.findByText('Tablet cabina 1');

    await usuario.click(within(filaDe('Tablet cabina 1')).getByRole('button', { name: /Revocar/ }));
    await usuario.type(screen.getByLabelText(/Motivo/), 'Robo del vehículo el 2026-09-12');
    await usuario.click(screen.getByRole('button', { name: /Confirmar revocación/ }));

    await waitFor(() => expect(api.actualizar).toHaveBeenCalledWith(
      '/dispositivos/d1/revocar', { motivo: 'Robo del vehículo el 2026-09-12' }));
  });

  it('dice CUÁNTAS sesiones cortó, que es lo que prueba que funcionó', async () => {
    /* Revocar toca Postgres y Redis: la marca impide futuros logins y el
       borrado corta las sesiones ya abiertas. «Revocado» a secas no distingue
       entre las dos mitades; el número sí. */
    const usuario = userEvent.setup();
    render(<Dispositivos />);
    await screen.findByText('Tablet cabina 1');

    await usuario.click(within(filaDe('Tablet cabina 1')).getByRole('button', { name: /Revocar/ }));
    await usuario.type(screen.getByLabelText(/Motivo/), 'Robo del vehículo el 2026-09-12');
    await usuario.click(screen.getByRole('button', { name: /Confirmar revocación/ }));

    expect(await screen.findByText(/2 sesion/i)).toBeInTheDocument();
  });

  it('cero sesiones cortadas TAMBIÉN se dice, y no es un fallo', async () => {
    // Un aparato que no tenía sesión abierta se revoca igual: queda marcado y
    // no podrá volver a entrar. Callarlo haría pensar que no pasó nada.
    const usuario = userEvent.setup();
    api.actualizar.mockResolvedValue({ id: 'd1', revocado: true, sesionesCortadas: 0 });
    render(<Dispositivos />);
    await screen.findByText('Tablet cabina 1');

    await usuario.click(within(filaDe('Tablet cabina 1')).getByRole('button', { name: /Revocar/ }));
    await usuario.type(screen.getByLabelText(/Motivo/), 'Empleado que deja la empresa');
    await usuario.click(screen.getByRole('button', { name: /Confirmar revocación/ }));

    expect(await screen.findByText(/no tenía ninguna sesión abierta/i)).toBeInTheDocument();
  });

  it('a uno ya revocado no se le ofrece revocar otra vez', async () => {
    render(<Dispositivos />);
    await screen.findByText('iPad supervisión');
    expect(within(filaDe('iPad supervisión')).queryByRole('button', { name: /Revocar/ }))
      .not.toBeInTheDocument();
  });

  it('si falla, lo dice y no deja creer que el aparato quedó fuera', async () => {
    const usuario = userEvent.setup();
    api.actualizar.mockRejectedValue(new ErrorApi(500, 'Redis no responde'));
    render(<Dispositivos />);
    await screen.findByText('Tablet cabina 1');

    await usuario.click(within(filaDe('Tablet cabina 1')).getByRole('button', { name: /Revocar/ }));
    await usuario.type(screen.getByLabelText(/Motivo/), 'Robo del vehículo el 2026-09-12');
    await usuario.click(screen.getByRole('button', { name: /Confirmar revocación/ }));

    expect(await screen.findByText(/Redis no responde/)).toBeInTheDocument();
    /* Se afirma sobre el MENSAJE DE RESULTADO, no sobre la palabra «sesión»:
       el texto que explica qué hace revocar también la contiene, así que
       `queryByText(/sesion/i)` casaba con la explicación y esta prueba pasaba
       —o fallaba— por el motivo equivocado. Segunda vez hoy que una regex
       demasiado ancha casa con la etiqueta en vez de con el dato. */
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // Y el formulario sigue abierto: el aparato NO quedó fuera.
    expect(screen.getByRole('button', { name: /Confirmar revocación/ })).toBeInTheDocument();
  });

  it('tras revocar, la lista se relee', async () => {
    const usuario = userEvent.setup();
    render(<Dispositivos />);
    await screen.findByText('Tablet cabina 1');
    const antes = api.listar.mock.calls.length;

    await usuario.click(within(filaDe('Tablet cabina 1')).getByRole('button', { name: /Revocar/ }));
    await usuario.type(screen.getByLabelText(/Motivo/), 'Robo del vehículo el 2026-09-12');
    await usuario.click(screen.getByRole('button', { name: /Confirmar revocación/ }));

    await waitFor(() => expect(api.listar.mock.calls.length).toBeGreaterThan(antes));
  });
});

describe('arrepentirse', () => {
  it('cancelar cierra el formulario y NO revoca nada', async () => {
    // Revocar corta el acceso de un aparato en uso: la salida sin consecuencias
    // tiene que estar a un clic, y probada.
    const usuario = userEvent.setup();
    render(<Dispositivos />);
    await screen.findByText('Tablet cabina 1');

    await usuario.click(within(filaDe('Tablet cabina 1')).getByRole('button', { name: /Revocar/ }));
    await usuario.type(screen.getByLabelText(/Motivo/), 'Me equivoqué de aparato');
    await usuario.click(screen.getByRole('button', { name: /^Cancelar$/ }));

    expect(api.actualizar).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Confirmar revocación/ })).not.toBeInTheDocument();
  });

  it('sin dispositivos lo dice', async () => {
    api.listar.mockResolvedValue([]);
    render(<Dispositivos />);
    expect(await screen.findByText(/Ningún dispositivo/i)).toBeInTheDocument();
  });
});
