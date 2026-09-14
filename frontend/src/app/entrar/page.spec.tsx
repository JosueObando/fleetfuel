import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Entrar from './page';
import { ErrorApi } from '@/api/cliente';
import { rellenar } from '../../../pruebas/rellenar';

const empujar = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: empujar }) }));
jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return {
    ...real,
    entrar: jest.fn(), guardarSesion: jest.fn(),
    iniciarMfa: jest.fn(), confirmarMfa: jest.fn(),
  };
});
const { entrar, guardarSesion, iniciarMfa, confirmarMfa } =
  jest.requireMock('@/api/cliente') as {
    entrar: jest.Mock; guardarSesion: jest.Mock;
    iniciarMfa: jest.Mock; confirmarMfa: jest.Mock;
  };

/*
 * La única pantalla pública del sistema. Es la que ve alguien que todavía no es
 * nadie, y la que decide si entra.
 */

const SESION = {
  accessToken: 'a', refreshToken: 'r',
  usuario: { id: '1', nombre: 'Ana', correo: 'ana@fleetfuel.jop.lat', roles: [] },
};

const rellenarLogin = async (usuario: ReturnType<typeof userEvent.setup>, totp?: string) => {
  await rellenar(usuario, screen.getByLabelText(/Correo/), 'ana@fleetfuel.jop.lat');
  await rellenar(usuario, screen.getByLabelText(/Contraseña/), 'ClaveDePrueba123');
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
    await rellenarLogin(usuario);
    await waitFor(() => expect(guardarSesion).toHaveBeenCalledWith(SESION));
    expect(empujar).toHaveBeenCalledWith('/operacion/ordenes');
  });

  it('el código TOTP vacío NO se manda', async () => {
    // Mandarlo vacío hace que el backend lo valide contra `^\\d{6}$` y responda
    // 400 en vez de la puerta de MFA, que es un mensaje distinto y confuso.
    const usuario = userEvent.setup();
    render(<Entrar />);
    await rellenarLogin(usuario);
    await waitFor(() => expect(entrar).toHaveBeenCalled());
    expect(entrar).toHaveBeenCalledWith('ana@fleetfuel.jop.lat', 'ClaveDePrueba123', undefined);
  });

  it('y sí se manda cuando lo hay', async () => {
    const usuario = userEvent.setup();
    render(<Entrar />);
    await rellenarLogin(usuario, '123456');
    await waitFor(() => expect(entrar).toHaveBeenCalled());
    expect(entrar).toHaveBeenCalledWith('ana@fleetfuel.jop.lat', 'ClaveDePrueba123', '123456');
  });
});

describe('la puerta del §7: MFA sin inscribir', () => {
  /*
   * Hasta el 2026-09-12 esto sólo enseñaba un aviso — y ahí se acababa el
   * camino. `/auth/mfa/iniciar` y `/auth/mfa/confirmar` existían en la API
   * desde la Fase 0.3 y NINGUNA pantalla los llamaba, así que un usuario nuevo
   * no podía entrar al sistema por la interfaz: había que inscribirle el TOTP
   * por curl. Los recorridos e2e lo hacían por la API, que es exactamente por
   * lo que nadie lo echaba de menos.
   */
  beforeEach(() => {
    entrar.mockResolvedValue({ ...SESION, debeInscribirMfa: true });
    iniciarMfa.mockResolvedValue({ secreto: 'JBSWY3DPEHPK3PXP', otpauth: 'otpauth://totp/x' });
    confirmarMfa.mockResolvedValue({ mfaHabilitado: true });
  });

  it('NO deja pasar, aunque el login haya devuelto 200', async () => {
    // El token que devuelve ese login viene con cero permisos: dejarlo entrar
    // significaría una aplicación que responde 403 a todo, y el usuario
    // buscando el fallo en el sitio equivocado.
    const usuario = userEvent.setup();
    render(<Entrar />);
    await rellenarLogin(usuario);

    await screen.findByRole('heading', { name: /segundo factor/i });
    expect(empujar).not.toHaveBeenCalled();
    expect(guardarSesion).not.toHaveBeenCalled();
  });

  it('pide el secreto con el token de inscripción, no con una sesión', async () => {
    const usuario = userEvent.setup();
    render(<Entrar />);
    await rellenarLogin(usuario);
    await waitFor(() => expect(iniciarMfa).toHaveBeenCalledWith(SESION.accessToken));
  });

  it('enseña el secreto para poder escribirlo a mano', async () => {
    /* Sin librería de QR: añadir una dependencia de terceros a la pantalla de
       entrada —la única pública del sistema— por dibujar un cuadrado es mal
       negocio. El secreto en claro y el enlace `otpauth://` cubren los dos
       caminos: teclearlo, o tocarlo desde el móvil para que lo abra la
       aplicación de autenticación. */
    const usuario = userEvent.setup();
    render(<Entrar />);
    await rellenarLogin(usuario);
    expect(await screen.findByText(/JBSW\s?Y3DP\s?EHPK\s?3PXP/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /aplicación de autenticación/i }))
      .toHaveAttribute('href', 'otpauth://totp/x');
  });

  it('confirma con el código y avisa de que ya puede entrar', async () => {
    const usuario = userEvent.setup();
    render(<Entrar />);
    await rellenarLogin(usuario);
    await screen.findByRole('heading', { name: /segundo factor/i });

    await rellenar(usuario, screen.getByLabelText(/Código de 6 dígitos/), '123456');
    await usuario.click(screen.getByRole('button', { name: /Confirmar/ }));

    await waitFor(() =>
      expect(confirmarMfa).toHaveBeenCalledWith(SESION.accessToken, '123456'));
    expect(await screen.findByText(/Ya puedes entrar/i)).toBeInTheDocument();
  });

  it('tras confirmar NO entra sola: hace entrar de nuevo, ya con el código', async () => {
    /* El token de inscripción sigue siendo el de cero permisos —habilitar el
       MFA no le añade ninguno—, así que guardarlo abriría una aplicación que
       responde 403 a todo. Se vuelve al formulario, que es donde ahora sí
       existe el código de verificación. */
    const usuario = userEvent.setup();
    render(<Entrar />);
    await rellenarLogin(usuario);
    await screen.findByRole('heading', { name: /segundo factor/i });
    await rellenar(usuario, screen.getByLabelText(/Código de 6 dígitos/), '123456');
    await usuario.click(screen.getByRole('button', { name: /Confirmar/ }));

    await screen.findByText(/Ya puedes entrar/i);
    expect(guardarSesion).not.toHaveBeenCalled();
    expect(empujar).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Código de verificación/)).toBeInTheDocument();
  });

  it('un código incorrecto se dice y se puede reintentar', async () => {
    const usuario = userEvent.setup();
    confirmarMfa.mockRejectedValue(
      new ErrorApi(400, 'Código incorrecto. Revisa la hora del dispositivo.'));
    render(<Entrar />);
    await rellenarLogin(usuario);
    await screen.findByRole('heading', { name: /segundo factor/i });

    await rellenar(usuario, screen.getByLabelText(/Código de 6 dígitos/), '000000');
    await usuario.click(screen.getByRole('button', { name: /Confirmar/ }));

    expect(await screen.findByText(/Revisa la hora del dispositivo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmar/ })).toBeEnabled();
  });

  it('si el secreto no llega, lo dice en vez de enseñar un hueco', async () => {
    const usuario = userEvent.setup();
    iniciarMfa.mockRejectedValue(new ErrorApi(500, 'No se pudo generar el secreto'));
    render(<Entrar />);
    await rellenarLogin(usuario);
    expect(await screen.findByText(/No se pudo generar el secreto/)).toBeInTheDocument();
  });
});

describe('cuando no entra', () => {
  it('enseña el mensaje del servidor, no uno genérico', async () => {
    const usuario = userEvent.setup();
    entrar.mockRejectedValue(new ErrorApi(401, 'Credenciales inválidas'));
    render(<Entrar />);
    await rellenarLogin(usuario);
    expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument();
    expect(empujar).not.toHaveBeenCalled();
  });

  it('el 429 del freno llega tal cual: dice que espere, no que se equivocó', async () => {
    const usuario = userEvent.setup();
    entrar.mockRejectedValue(new ErrorApi(429, 'Demasiados intentos. Espera un momento y vuelve a intentarlo.'));
    render(<Entrar />);
    await rellenarLogin(usuario);
    expect(await screen.findByText(/Demasiados intentos/)).toBeInTheDocument();
  });

  it('si no hay servidor, lo dice en vez de callarse', async () => {
    const usuario = userEvent.setup();
    entrar.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Entrar />);
    await rellenarLogin(usuario);
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeInTheDocument();
  });

  it('tras fallar se puede reintentar: el botón vuelve a estar disponible', async () => {
    // Si `enviando` se quedara en true, el formulario quedaría muerto y la
    // única salida sería recargar la página.
    const usuario = userEvent.setup();
    entrar.mockRejectedValue(new ErrorApi(401, 'Credenciales inválidas'));
    render(<Entrar />);
    await rellenarLogin(usuario);
    await screen.findByText('Credenciales inválidas');

    entrar.mockResolvedValue(SESION);
    await usuario.click(screen.getByRole('button', { name: /Entrar/ }));
    await waitFor(() => expect(empujar).toHaveBeenCalledWith('/operacion/ordenes'));
  });
});
