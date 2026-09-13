import { act, render, screen, waitFor } from '@testing-library/react';
import { PuertaDeSesion } from './PuertaDeSesion';

const reemplazar = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: reemplazar }) }));

let avisar: (() => void) | null = null;
jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return {
    ...real,
    instantaneaDeSesion: jest.fn(),
    sesionDelServidor: () => null,
    suscribirseASesion: (fn: () => void) => { avisar = fn; return () => { avisar = null; }; },
  };
});
const { instantaneaDeSesion: leerSesion } =
  jest.requireMock('@/api/cliente') as { instantaneaDeSesion: jest.Mock };

/*
 * La puerta, sola.
 *
 * Vivía dentro de `ShellApp` y por eso sólo protegía lo que llevaba su
 * navegación. `/tablero` no la lleva —tiene su propio shell de tres columnas—
 * y quedó SIN PUERTA: hasta el 2026-09-12 era además la primera pantalla del
 * dominio, servida a cualquiera que llegara sin enlace.
 *
 * La alternativa era copiar la comprobación en el layout del tablero. Dos
 * copias de una puerta divergen: la que se olvide de actualizar es la que deja
 * pasar, y nadie mira una puerta que «ya funcionaba».
 */

const SESION = { accessToken: 'a', usuario: { id: '1', nombre: 'Ana', correo: 'a@x.pa', roles: [] } };

beforeEach(() => { jest.clearAllMocks(); avisar = null; });

it('sin sesión no pinta lo que protege, y manda a entrar', async () => {
  leerSesion.mockReturnValue(null);
  render(<PuertaDeSesion><p>contenido reservado</p></PuertaDeSesion>);
  expect(screen.queryByText('contenido reservado')).not.toBeInTheDocument();
  await waitFor(() => expect(reemplazar).toHaveBeenCalledWith('/entrar'));
});

it('mientras comprueba, dice que está comprobando', () => {
  leerSesion.mockReturnValue(null);
  render(<PuertaDeSesion><p>contenido</p></PuertaDeSesion>);
  expect(screen.getByText(/Comprobando la sesión/)).toBeInTheDocument();
});

it('con sesión pinta y no redirige', async () => {
  leerSesion.mockReturnValue(SESION);
  render(<PuertaDeSesion><p>contenido reservado</p></PuertaDeSesion>);
  expect(await screen.findByText('contenido reservado')).toBeInTheDocument();
  expect(reemplazar).not.toHaveBeenCalled();
});

it('si la sesión desaparece por debajo, echa sin esperar a que nadie navegue', async () => {
  // Un 401 a mitad de una petición, o alguien que cierra sesión en otra pestaña.
  leerSesion.mockReturnValue(SESION);
  render(<PuertaDeSesion><p>contenido reservado</p></PuertaDeSesion>);
  expect(await screen.findByText('contenido reservado')).toBeInTheDocument();

  leerSesion.mockReturnValue(null);
  act(() => avisar?.());

  expect(screen.queryByText('contenido reservado')).not.toBeInTheDocument();
  await waitFor(() => expect(reemplazar).toHaveBeenCalledWith('/entrar'));
});
