import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Entrar from './page';
import { ErrorApi } from '@/api/cliente';

const empujar = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: empujar }) }));
jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, entrar: jest.fn(), guardarSesion: jest.fn() };
});
const { entrar, guardarSesion } = jest.requireMock('@/api/cliente') as {
  entrar: jest.Mock; guardarSesion: jest.Mock;
};

/*
 * La única pantalla pública del sistema. Es la que ve alguien que todavía no es
 * nadie, y la que decide si entra.
 */

const SESION = {
  accessToken: 'a', refreshToken: 'r',
  usuario: { id: '1', nombre: 'Ana', correo: 'ana@mupa.gob.pa', roles: [] },
};

const rellenar = async (usuario: ReturnType<typeof userEvent.setup>, totp?: string) => {
  await usuario.type(screen.getByLabelText(/Correo/), 'ana@mupa.gob.pa');
  await usuario.type(screen.getByLabelText(/Contraseña/), 'ClaveDePrueba123');
  if (totp) await usuario.type(screen.getByLabelText(/Código de verificación/), totp);
  await usuario.click(screen.getByRole('button', { name: /Entrar/ }));
};

beforeEach(() => { jest.clearAllMocks(); entrar.mockResolvedValue(SESION); });

describe('el formulario', () => {
  it('los tres campos se encuentran por su etiqueta', () => {
    render(<Entrar />);
    expect(screen.getByLabelText(/Correo/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Contraseña/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Código de verificación/)).toBeInTheDocument();
  });

  it('la contraseña no se ve al escribirla', () => {
    render(<Entrar />);
    expect(screen.getByLabelText(/Contraseña/)).toHaveAttribute('type', 'password');
  });

  it('los gestores de contraseñas saben qué campo es cuál', () => {
    // Sin `autoComplete`, el gestor no ofrece la credencial guardada y la gente
    // acaba escribiéndola a mano — o eligiendo una más corta.
    render(<Entrar />);
    expect(screen.getByLabelText(/Correo/)).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText(/Contraseña/)).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText(/Código de verificación/)).toHaveAttribute('autocomplete', 'one-time-code');
  });
});

describe('entrar bien', () => {
  it('guarda la sesión y lleva a la operación', async () => {
    const usuario = userEvent.setup();
    render(<Entrar />);
    await rellenar(usuario);
    await waitFor(() => expect(guardarSesion).toHaveBeenCalledWith(SESION));
    expect(empujar).toHaveBeenCalledWith('/operacion/ordenes');
  });

  it('el código TOTP vacío NO se manda', async () => {
    // Mandarlo vacío hace que el backend lo valide contra `^\\d{6}$` y responda
    // 400 en vez de la puerta de MFA, que es un mensaje distinto y confuso.
    const usuario = userEvent.setup();
    render(<Entrar />);
    await rellenar(usuario);
    await waitFor(() => expect(entrar).toHaveBeenCalled());
    expect(entrar).toHaveBeenCalledWith('ana@mupa.gob.pa', 'ClaveDePrueba123', undefined);
  });

  it('y sí se manda cuando lo hay', async () => {
    const usuario = userEvent.setup();
    render(<Entrar />);
    await rellenar(usuario, '123456');
    await waitFor(() => expect(entrar).toHaveBeenCalled());
    expect(entrar).toHaveBeenCalledWith('ana@mupa.gob.pa', 'ClaveDePrueba123', '123456');
  });
});

describe('la puerta del §7: MFA sin inscribir', () => {
  it('NO deja pasar, aunque el login haya devuelto 200', async () => {
    // El token que devuelve ese login viene con cero permisos: dejarlo entrar
    // significaría una aplicación que responde 403 a todo, y el usuario
    // buscando el fallo en el sitio equivocado.
    const usuario = userEvent.setup();
    entrar.mockResolvedValue({ ...SESION, debeInscribirMfa: true });
    render(<Entrar />);
    await rellenar(usuario);

    expect(await screen.findByText(/segundo factor inscrito/i)).toBeInTheDocument();
    expect(empujar).not.toHaveBeenCalled();
    expect(guardarSesion).not.toHaveBeenCalled();
  });
});

describe('cuando no entra', () => {
  it('enseña el mensaje del servidor, no uno genérico', async () => {
    const usuario = userEvent.setup();
    entrar.mockRejectedValue(new ErrorApi(401, 'Credenciales inválidas'));
    render(<Entrar />);
    await rellenar(usuario);
    expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument();
    expect(empujar).not.toHaveBeenCalled();
  });

  it('el 429 del freno llega tal cual: dice que espere, no que se equivocó', async () => {
    const usuario = userEvent.setup();
    entrar.mockRejectedValue(new ErrorApi(429, 'Demasiados intentos. Espera un momento y vuelve a intentarlo.'));
    render(<Entrar />);
    await rellenar(usuario);
    expect(await screen.findByText(/Demasiados intentos/)).toBeInTheDocument();
  });

  it('si no hay servidor, lo dice en vez de callarse', async () => {
    const usuario = userEvent.setup();
    entrar.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Entrar />);
    await rellenar(usuario);
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeInTheDocument();
  });

  it('tras fallar se puede reintentar: el botón vuelve a estar disponible', async () => {
    // Si `enviando` se quedara en true, el formulario quedaría muerto y la
    // única salida sería recargar la página.
    const usuario = userEvent.setup();
    entrar.mockRejectedValue(new ErrorApi(401, 'Credenciales inválidas'));
    render(<Entrar />);
    await rellenar(usuario);
    await screen.findByText('Credenciales inválidas');

    entrar.mockResolvedValue(SESION);
    await usuario.click(screen.getByRole('button', { name: /Entrar/ }));
    await waitFor(() => expect(empujar).toHaveBeenCalledWith('/operacion/ordenes'));
  });
});
