import { render, screen, waitFor } from '@testing-library/react';
import { ShellApp } from './ShellApp';

const reemplazar = jest.fn();
let rutaActual = '/operacion/ordenes';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: reemplazar, push: jest.fn() }),
  usePathname: () => rutaActual,
}));
jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, leerSesion: jest.fn(), guardarSesion: jest.fn() };
});
const { leerSesion } = jest.requireMock('@/api/cliente') as { leerSesion: jest.Mock };

/*
 * El shell de la aplicación autenticada. Hace dos cosas y las dos importan:
 * guarda la puerta, y es la navegación única —dos copias divergirían en cuanto
 * se añadiera una sección—.
 */

const SESION = { accessToken: 'a', usuario: { id: '1', nombre: 'Ana', correo: 'a@x.pa', roles: [] } };

beforeEach(() => { jest.clearAllMocks(); rutaActual = '/operacion/ordenes'; });

describe('la puerta', () => {
  it('sin sesión NO pinta la aplicación: manda a entrar', async () => {
    // Si se pintara antes de comprobar, quien no ha entrado vería un instante
    // la aplicación entera y luego el salto — y ese instante basta para leer
    // una pantalla.
    leerSesion.mockReturnValue(null);
    render(<ShellApp><p>contenido reservado</p></ShellApp>);
    expect(screen.queryByText('contenido reservado')).not.toBeInTheDocument();
    await waitFor(() => expect(reemplazar).toHaveBeenCalledWith('/entrar'));
  });

  it('mientras comprueba, dice que está comprobando', () => {
    leerSesion.mockReturnValue(null);
    render(<ShellApp><p>contenido</p></ShellApp>);
    expect(screen.getByText(/Comprobando la sesión/)).toBeInTheDocument();
  });

  it('con sesión sí pinta, y no redirige', async () => {
    leerSesion.mockReturnValue(SESION);
    render(<ShellApp><p>contenido reservado</p></ShellApp>);
    expect(await screen.findByText('contenido reservado')).toBeInTheDocument();
    expect(reemplazar).not.toHaveBeenCalled();
  });
});

describe('la navegación', () => {
  beforeEach(() => leerSesion.mockReturnValue(SESION));

  it('se anuncia como navegación principal', async () => {
    render(<ShellApp><p>x</p></ShellApp>);
    expect(await screen.findByRole('navigation', { name: /Navegación principal/ })).toBeInTheDocument();
  });

  it('están las dos secciones y sus ocho destinos', async () => {
    render(<ShellApp><p>x</p></ShellApp>);
    await screen.findByRole('navigation');
    for (const etiqueta of ['Órdenes', 'Viajes', 'Clientes', 'Estaciones',
                            'Productos', 'Vehículos', 'Cisternas', 'Conductores']) {
      expect(screen.getByRole('button', { name: new RegExp(etiqueta) })).toBeInTheDocument();
    }
  });

  it('marca como actual SOLO la sección en la que se está', async () => {
    rutaActual = '/catalogos/vehiculos';
    render(<ShellApp><p>x</p></ShellApp>);
    await screen.findByRole('navigation');
    const actuales = screen.getAllByRole('button')
      .filter(b => b.getAttribute('aria-current') === 'page');
    expect(actuales).toHaveLength(1);
    expect(actuales[0]).toHaveAccessibleName(expect.stringContaining('Vehículos'));
  });

  it('en una ruta que no está en el menú, no marca nada', async () => {
    rutaActual = '/tablero';
    render(<ShellApp><p>x</p></ShellApp>);
    await screen.findByRole('navigation');
    expect(screen.getAllByRole('button').filter(b => b.getAttribute('aria-current') === 'page'))
      .toHaveLength(0);
  });
});
