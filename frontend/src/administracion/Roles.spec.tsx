import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Roles } from './Roles';
import { ErrorApi } from '@/api/cliente';
import { rellenar } from '../../pruebas/rellenar';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return {
    ...real,
    api: { listar: jest.fn(), crear: jest.fn(), reemplazar: jest.fn() },
  };
});
const { api } = jest.requireMock('@/api/cliente') as {
  api: { listar: jest.Mock; crear: jest.Mock; reemplazar: jest.Mock };
};

/*
 * §5 · Los roles y lo que cada uno puede hacer.
 *
 * ESTA PANTALLA EXISTE POR UN INCIDENTE CONCRETO
 *
 * Producción estuvo días con un rol «Administrador» que tenía 11 permisos de
 * 48 y no podía ni leer un cliente. La causa fue una migración que reparte
 * permisos buscando el rol POR NOMBRE y no falla si no lo encuentra; el efecto
 * fue invisible porque todas las comprobaciones iban por `/api/salud` y
 * `/auth/login`, que no tocan permisos.
 *
 * Nadie lo vio porque NO HABÍA DÓNDE VERLO. Por eso el recuento «11 de 48» es
 * un requisito de esta pantalla y tiene prueba propia: es la cifra que habría
 * delatado el fallo el primer día, sin que nadie fuera a buscarlo.
 */

const ROLES = [
  { id: 'r1', nombre: 'Administrador', descripcion: 'Todo el sistema', exigeMfa: true,
    permisos: ['clientes:leer', 'clientes:crear', 'viajes:autorizar'] },
  { id: 'r2', nombre: 'Despachador', descripcion: 'Autoriza salida', exigeMfa: false,
    permisos: ['clientes:leer'] },
];
const PERMISOS = [
  { codigo: 'clientes:leer',    descripcion: 'Ver clientes',      modulo: 'clientes' },
  { codigo: 'clientes:crear',   descripcion: 'Crear clientes',    modulo: 'clientes' },
  { codigo: 'clientes:eliminar', descripcion: 'Dar de baja',      modulo: 'clientes' },
  { codigo: 'viajes:autorizar', descripcion: 'Autorizar salida',  modulo: 'viajes' },
];

beforeEach(() => {
  jest.clearAllMocks();
  api.listar.mockImplementation((ruta: string) =>
    Promise.resolve(ruta === '/roles' ? ROLES : PERMISOS));
});

describe('la lista de roles', () => {
  it('enseña cada rol con su descripción', async () => {
    render(<Roles />);
    expect(await screen.findByRole('button', { name: /Administrador/ })).toBeInTheDocument();
    expect(screen.getByText('Autoriza salida')).toBeInTheDocument();
  });

  it('dice cuántos permisos tiene de cuántos hay — la cifra del incidente', async () => {
    /* «1 de 4» en el Despachador es la forma de que un reparto que no se
       aplicó salte a la vista. Un rol enseñado sólo con su nombre se ve igual
       de bien con 48 permisos que con 11. */
    render(<Roles />);
    await screen.findByRole('button', { name: /Administrador/ });
    expect(screen.getByRole('button', { name: /Despachador/ })).toHaveTextContent(/1 de 4/);
    expect(screen.getByRole('button', { name: /Administrador/ })).toHaveTextContent(/3 de 4/);
  });

  it('marca los roles que exigen segundo factor', async () => {
    render(<Roles />);
    expect(await screen.findByRole('button', { name: /Administrador/ })).toHaveTextContent(/MFA/);
  });
});

describe('editar los permisos de un rol', () => {
  it('marca los que el rol ya tiene y deja sin marcar los demás', async () => {
    const usuario = userEvent.setup();
    render(<Roles />);
    await usuario.click(await screen.findByRole('button', { name: /Despachador/ }));

    expect(screen.getByRole('checkbox', { name: /Ver clientes/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Crear clientes/ })).not.toBeChecked();
  });

  it('los agrupa por módulo, que es como se leen 48 casillas', async () => {
    const usuario = userEvent.setup();
    render(<Roles />);
    await usuario.click(await screen.findByRole('button', { name: /Despachador/ }));

    const grupo = screen.getByRole('group', { name: /clientes/i });
    expect(within(grupo).getAllByRole('checkbox')).toHaveLength(3);
  });

  it('guarda el conjunto COMPLETO, no sólo lo que cambió', async () => {
    /* Es un PUT: lo que no va en la lista se pierde. Mandar sólo el permiso
       recién marcado dejaría al rol con ese único permiso — que es exactamente
       la forma del incidente del Administrador, esta vez provocada desde la
       interfaz. */
    const usuario = userEvent.setup();
    api.reemplazar.mockResolvedValue({ ok: true });
    render(<Roles />);
    await usuario.click(await screen.findByRole('button', { name: /Despachador/ }));

    await usuario.click(screen.getByRole('checkbox', { name: /Crear clientes/ }));
    await usuario.click(screen.getByRole('button', { name: /Guardar permisos/ }));

    await waitFor(() => expect(api.reemplazar).toHaveBeenCalledWith(
      '/roles/r2/permisos', { permisos: ['clientes:leer', 'clientes:crear'] }));
  });

  it('desmarcar todo manda una lista vacía, y eso es una decisión', async () => {
    const usuario = userEvent.setup();
    api.reemplazar.mockResolvedValue({ ok: true });
    render(<Roles />);
    await usuario.click(await screen.findByRole('button', { name: /Despachador/ }));

    await usuario.click(screen.getByRole('checkbox', { name: /Ver clientes/ }));
    await usuario.click(screen.getByRole('button', { name: /Guardar permisos/ }));

    await waitFor(() => expect(api.reemplazar).toHaveBeenCalledWith(
      '/roles/r2/permisos', { permisos: [] }));
  });

  it('cambiar de rol NO arrastra las casillas del anterior', async () => {
    /* La misma clase de fallo que ya apareció en viajes e informes: la
       selección se DERIVA del rol abierto en vez de vivir suelta, así que no
       puede quedarse la del anterior. */
    const usuario = userEvent.setup();
    render(<Roles />);
    await usuario.click(await screen.findByRole('button', { name: /Administrador/ }));
    expect(screen.getByRole('checkbox', { name: /Autorizar salida/ })).toBeChecked();

    await usuario.click(screen.getByRole('button', { name: /Despachador/ }));
    expect(screen.getByRole('checkbox', { name: /Autorizar salida/ })).not.toBeChecked();
  });

  it('si guardar falla, lo dice y no deja creer que se guardó', async () => {
    const usuario = userEvent.setup();
    api.reemplazar.mockRejectedValue(new ErrorApi(403, 'No tienes permiso para administrar roles'));
    render(<Roles />);
    await usuario.click(await screen.findByRole('button', { name: /Despachador/ }));
    await usuario.click(screen.getByRole('button', { name: /Guardar permisos/ }));

    expect(await screen.findByText(/No tienes permiso para administrar roles/)).toBeInTheDocument();
  });
});

describe('crear un rol', () => {
  it('manda nombre, descripción y si exige MFA', async () => {
    const usuario = userEvent.setup();
    api.crear.mockResolvedValue({ id: 'r9' });
    render(<Roles />);
    await screen.findByRole('button', { name: /Administrador/ });

    await usuario.click(screen.getByRole('button', { name: /Nuevo rol/ }));
    await rellenar(usuario, screen.getByLabelText(/Nombre/), 'Auditor');
    await rellenar(usuario, screen.getByLabelText(/Descripción/), 'Sólo lectura');
    await usuario.click(screen.getByRole('checkbox', { name: /Exige segundo factor/ }));
    await usuario.click(screen.getByRole('button', { name: /Crear rol/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalledWith('/roles', {
      nombre: 'Auditor', descripcion: 'Sólo lectura', exigeMfa: true,
    }));
  });

  it('un rol nuevo nace SIN permisos, y la pantalla lo dice', async () => {
    // Para que nadie lo cree y lo dé por hecho: crear el rol es la mitad del
    // trabajo, y la otra mitad es justo la que se olvidó en el incidente.
    const usuario = userEvent.setup();
    render(<Roles />);
    await screen.findByRole('button', { name: /Administrador/ });
    await usuario.click(screen.getByRole('button', { name: /Nuevo rol/ }));
    expect(screen.getByText(/sin permisos/i)).toBeInTheDocument();
  });
});

describe('los caminos que no salen bien', () => {
  it('si los roles no cargan, lo dice en vez de enseñar una lista vacía', async () => {
    // «Todavía no hay roles» ante un 403 es una mentira tranquilizadora: dice
    // que el sistema está vacío cuando lo que pasa es que no se puede mirar.
    api.listar.mockRejectedValue(new ErrorApi(403, 'No tienes permiso para ver roles'));
    render(<Roles />);
    expect(await screen.findByText(/No tienes permiso para ver roles/)).toBeInTheDocument();
  });

  it('si crear el rol falla, lo dice y conserva lo escrito', async () => {
    const usuario = userEvent.setup();
    api.crear.mockRejectedValue(new ErrorApi(409, 'Ya existe un rol con ese nombre'));
    render(<Roles />);
    await screen.findByRole('button', { name: /Administrador/ });

    await usuario.click(screen.getByRole('button', { name: /Nuevo rol/ }));
    await rellenar(usuario, screen.getByLabelText(/Nombre/), 'Administrador');
    await usuario.click(screen.getByRole('button', { name: /Crear rol/ }));

    expect(await screen.findByText(/Ya existe un rol con ese nombre/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre/)).toHaveValue('Administrador');
  });

  it('cancelar el alta no crea nada', async () => {
    const usuario = userEvent.setup();
    render(<Roles />);
    await screen.findByRole('button', { name: /Administrador/ });

    await usuario.click(screen.getByRole('button', { name: /Nuevo rol/ }));
    await usuario.click(screen.getByRole('button', { name: /Cancelar/ }));

    expect(api.crear).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Crear rol/ })).not.toBeInTheDocument();
  });

  it('cerrar el editor no guarda los cambios a medias', async () => {
    /* Marcar tres casillas y cerrar NO puede guardar: el único punto donde se
       escribe es «Guardar permisos», y confundir cerrar con guardar en esta
       pantalla concreta significa cambiar en silencio lo que puede hacer un
       rol entero. */
    const usuario = userEvent.setup();
    render(<Roles />);
    await usuario.click(await screen.findByRole('button', { name: /Despachador/ }));
    await usuario.click(screen.getByRole('checkbox', { name: /Crear clientes/ }));
    await usuario.click(screen.getByRole('button', { name: /Cerrar/ }));

    expect(api.reemplazar).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox', { name: /Crear clientes/ })).not.toBeInTheDocument();
  });

  it('y al reabrir el rol, las casillas vuelven a ser las suyas', async () => {
    // Lo marcado y no guardado no puede sobrevivir al cierre: se leería como
    // guardado la próxima vez que alguien abra el rol.
    const usuario = userEvent.setup();
    render(<Roles />);
    await usuario.click(await screen.findByRole('button', { name: /Despachador/ }));
    await usuario.click(screen.getByRole('checkbox', { name: /Crear clientes/ }));
    await usuario.click(screen.getByRole('button', { name: /Cerrar/ }));
    await usuario.click(screen.getByRole('button', { name: /Despachador/ }));

    expect(screen.getByRole('checkbox', { name: /Crear clientes/ })).not.toBeChecked();
  });
});
