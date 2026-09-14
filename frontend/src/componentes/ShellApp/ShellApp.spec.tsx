import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShellApp } from './ShellApp';

const reemplazar = jest.fn();
let rutaActual = '/operacion/ordenes';
const empujar = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: reemplazar, push: empujar }),
  usePathname: () => rutaActual,
}));
/*
 * Se dobla la INSTANTÁNEA y la suscripción, no `leerSesion`: desde el
 * 2026-09-12 el shell lee la sesión con `useSyncExternalStore` en vez de
 * copiarla a un estado con un efecto. `avisar` guarda la función con la que
 * React pide un re-render, para poder comprobar que la puerta reacciona cuando
 * la sesión desaparece por debajo.
 */
let avisar: (() => void) | null = null;
jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return {
    ...real,
    guardarSesion: jest.fn(),
    cerrarSesion: jest.fn(async () => undefined),
    instantaneaDeSesion: jest.fn(),
    sesionDelServidor: () => null,
    suscribirseASesion: (fn: () => void) => { avisar = fn; return () => { avisar = null; }; },
  };
});
const { instantaneaDeSesion: leerSesion, cerrarSesion, guardarSesion } =
  jest.requireMock('@/api/cliente') as {
    instantaneaDeSesion: jest.Mock; cerrarSesion: jest.Mock; guardarSesion: jest.Mock;
  };

/*
 * El shell de la aplicación autenticada. Hace dos cosas y las dos importan:
 * guarda la puerta, y es la navegación única —dos copias divergirían en cuanto
 * se añadiera una sección—.
 */

const SESION = { accessToken: 'a', usuario: { id: '1', nombre: 'Ana', correo: 'a@x.pa', roles: [] } };

beforeEach(() => { jest.clearAllMocks(); rutaActual = '/operacion/ordenes'; avisar = null; });

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
  it('si la sesión desaparece por debajo, echa de la aplicación sin navegar', async () => {
    // El caso real: un 401 a mitad de una petición limpia la sesión, o alguien
    // cierra sesión en otra pestaña. Copiando la sesión a un estado con un
    // efecto —como se hacía hasta el 2026-09-12— la pantalla seguía pintando la
    // aplicación entera hasta que la persona navegara a otro sitio.
    leerSesion.mockReturnValue(SESION);
    render(<ShellApp><p>contenido reservado</p></ShellApp>);
    expect(await screen.findByText('contenido reservado')).toBeInTheDocument();

    leerSesion.mockReturnValue(null);
    act(() => avisar?.());

    expect(screen.queryByText('contenido reservado')).not.toBeInTheDocument();
    await waitFor(() => expect(reemplazar).toHaveBeenCalledWith('/entrar'));
  });
});

describe('la navegación', () => {
  beforeEach(() => leerSesion.mockReturnValue(SESION));

  it('se anuncia como navegación principal', async () => {
    render(<ShellApp><p>x</p></ShellApp>);
    expect(await screen.findByRole('navigation', { name: /Navegación principal/ })).toBeInTheDocument();
  });

  it('están las cuatro secciones y sus diecinueve destinos, y NINGUNO más', async () => {
    /* La lista se comprueba ENTERA y con su tamaño, no destino a destino.
       Enumerando sólo los que se esperan, añadir una sección al menú no rompía
       nada —pasó dos veces el 2026-09-12, con «Despacho y cierre» e
       «Informes»—, y este fichero es el único sitio donde se afirma que la
       navegación no divergió. Un test cuyo nombre dice «ocho» y no cuenta
       ocho documenta lo que había, no lo que hay. */
    const DESTINOS = [
      'Órdenes', 'Viajes',
      // §15.3, del 2026-09-14: la semana por cisterna, antes de autorizar.
      'Planificador',
      'Despacho y cierre', 'Informes',
      // Las dos bandejas del 2026-09-13. El backend servía alertas (§22) y
      // solicitudes de ruta (§2C) desde el 07-09 sin forma de llegar a ellas.
      'Alertas', 'Solicitudes de ruta',
      // Finanzas, también del 13: `GET /gastos/pendientes` y `GET /liquidaciones`
      // existían desde 1C, y aprobar exigía abrir los viajes uno por uno.
      'Gastos por aprobar', 'Liquidaciones',
      'Clientes', 'Estaciones', 'Productos', 'Vehículos', 'Cisternas', 'Conductores',
      // Administración, desde el 2026-09-12. La API de usuarios y roles existía
      // desde la Fase 0.3 y no había forma de llegar a ella por la interfaz:
      // dar de alta a una persona exigía entrar por curl.
      'Usuarios', 'Roles y permisos',
      // Segunda tanda de §21, también del 2026-09-12: la bitácora de auditoría
      // sólo se podía leer con SQL, y revocar un aparato robado exigía curl.
      'Auditoría', 'Dispositivos',
    ];
    render(<ShellApp><p>x</p></ShellApp>);
    const nav = await screen.findByRole('navigation');

    for (const etiqueta of DESTINOS) {
      expect(within(nav).getByRole('button', { name: new RegExp(etiqueta) })).toBeInTheDocument();
    }
    // Los destinos, más «Cerrar sesión» y las dos utilidades de la barra.
    expect(within(nav).getAllByRole('button')).toHaveLength(DESTINOS.length + 3);
    // Y las secciones, que el nombre de esta prueba prometía y no comprobaba.
    expect(within(nav).getAllByRole('heading').map(h => h.textContent))
      .toEqual(['Operación', 'Finanzas', 'Catálogos', 'Administración']);
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

  it('pulsar un destino navega a su ruta', async () => {
    /* Nunca se había pulsado ninguno: las pruebas comprobaban que los botones
       ESTÁN y cómo se marcan, no que lleven a alguna parte. Un menú de doce
       entradas que no navega se ve idéntico a uno que sí, y la cobertura lo
       delató con una línea sin ejecutar. */
    const usuario = userEvent.setup();
    render(<ShellApp><p>x</p></ShellApp>);
    const nav = await screen.findByRole('navigation');
    await usuario.click(within(nav).getByRole('button', { name: /Usuarios/ }));
    expect(empujar).toHaveBeenCalledWith('/administracion/usuarios');
  });

  it('salir revoca la sesión en el servidor, no sólo en el navegador', async () => {
    /* El botón hacía `guardarSesion(null)` y ya: el refresh token seguía vivo
       en Redis hasta vencer, así que quien tuviera una copia podía seguir
       pidiendo tokens de acceso después de que la persona hubiera cerrado
       sesión. Ahora llama a `cerrarSesion`, que hace las dos mitades — y por eso
       el botón no puede olvidarse de la que habla con el servidor. */
    const usuario = userEvent.setup();
    render(<ShellApp><p>x</p></ShellApp>);
    await usuario.click(await screen.findByRole('button', { name: /Cerrar sesión/ }));

    await waitFor(() => expect(cerrarSesion).toHaveBeenCalled());
    expect(guardarSesion).not.toHaveBeenCalled();
    await waitFor(() => expect(reemplazar).toHaveBeenCalledWith('/entrar'));
  });

  it('en una ruta que no está en el menú, no marca nada', async () => {
    rutaActual = '/tablero';
    render(<ShellApp><p>x</p></ShellApp>);
    await screen.findByRole('navigation');
    expect(screen.getAllByRole('button').filter(b => b.getAttribute('aria-current') === 'page'))
      .toHaveLength(0);
  });
});
