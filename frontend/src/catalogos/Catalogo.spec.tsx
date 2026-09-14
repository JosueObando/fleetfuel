import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Catalogo } from './Catalogo';
import { ErrorApi } from '@/api/cliente';
import type { CatalogoDef } from './definiciones';
import { rellenar } from '../../pruebas/rellenar';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return {
    ...real,
    api: {
      listar: jest.fn(), obtener: jest.fn(),
      crear: jest.fn(), actualizar: jest.fn(), desactivar: jest.fn(),
    },
  };
});
const { api } = jest.requireMock('@/api/cliente') as {
  api: Record<'listar' | 'crear' | 'actualizar' | 'desactivar', jest.Mock>;
};

/*
 * La pantalla que un operador usa todos los días: los cinco catálogos simples
 * comparten este componente, así que lo que se rompa aquí se rompe cinco veces.
 *
 * Se prueba la conducta visible —lo que se ve, lo que se envía— y no el estado
 * interno. `api` sí va sustituido: lo que interesa comprobar es QUÉ se le pide,
 * no que fetch funcione, y eso ya lo cubre `cliente.spec.ts`.
 */

const DEF: CatalogoDef = {
  ruta: '/clientes', titulo: 'Clientes', singular: 'cliente', permisoBase: 'clientes',
  columnas: [
    { nombre: 'nombre', etiqueta: 'Nombre' },
    { nombre: 'ruc', etiqueta: 'RUC' },
  ],
  campos: [
    { nombre: 'nombre', etiqueta: 'Nombre', requerido: true },
    { nombre: 'ruc', etiqueta: 'RUC', soloAlta: true },
    { nombre: 'cupo', etiqueta: 'Cupo', tipo: 'number' },
    { nombre: 'alta', etiqueta: 'Fecha de alta', tipo: 'date' },
  ],
};

const FILAS = [
  { id: '1', nombre: 'Terpelo Panamá', ruc: '8-NT-1', cupo: 500, alta: '2026-03-01T10:20:30.000Z' },
  { id: '2', nombre: 'Sin RUC', ruc: null, cupo: null, alta: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  api.listar.mockResolvedValue(FILAS);
  api.crear.mockResolvedValue({ id: '3' });
  api.actualizar.mockResolvedValue({ id: '1' });
  api.desactivar.mockResolvedValue(undefined);
});

describe('la lista', () => {
  it('muestra esqueletos mientras carga, no un spinner', async () => {
    // Decisión del spec: bloques por panel. Un spinner centrado no dice cuánto
    // contenido va a llegar y la pantalla salta cuando aparece.
    let resolver: (v: unknown) => void = () => undefined;
    api.listar.mockReturnValue(new Promise(r => { resolver = r; }));
    const { container } = render(<Catalogo def={DEF} />);
    expect(container.querySelectorAll('[class*="esqueleto"]').length).toBe(4);
    resolver(FILAS);
    await waitFor(() => expect(screen.getByRole('cell', { name: 'Terpelo Panamá' })).toBeInTheDocument());
  });

  it('pinta una fila por registro', async () => {
    render(<Catalogo def={DEF} />);
    // `getByRole('cell')` y no `getByText`: el nombre aparece TAMBIÉN en el
    // texto para lectores de pantalla de los dos botones de la fila, que es
    // justamente la propiedad que se fija más abajo.
    expect(await screen.findByRole('cell', { name: 'Terpelo Panamá' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Sin RUC' })).toBeInTheDocument();
  });

  it('los huecos se ven como «—», no como «null»', async () => {
    // `null` escrito en una celda parece un dato y confunde; la raya dice
    // «aquí no hay nada» sin ambigüedad.
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Sin RUC');
    const fila = screen.getByRole('row', { name: /Sin RUC/ });
    expect(within(fila).getAllByText('—').length).toBeGreaterThan(0);
    expect(within(fila).queryByText('null')).not.toBeInTheDocument();
  });

  it('sin registros lo dice, en vez de dejar una tabla vacía', async () => {
    api.listar.mockResolvedValue([]);
    render(<Catalogo def={DEF} />);
    expect(await screen.findByText(/Todavía no hay clientes/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('si la carga falla, enseña el mensaje del servidor', async () => {
    api.listar.mockRejectedValue(new ErrorApi(403, 'Permisos insuficientes. Faltan: clientes:leer'));
    render(<Catalogo def={DEF} />);
    expect(await screen.findByText(/Faltan: clientes:leer/)).toBeInTheDocument();
  });

  it('ante un fallo que no viene de la API, no se queda cargando para siempre', async () => {
    // Un error de red o un fallo de JSON no traen mensaje; sin este camino la
    // pantalla se quedaría con los esqueletos puestos indefinidamente.
    api.listar.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Catalogo def={DEF} />);
    expect(await screen.findByText(/No se pudo cargar la lista/)).toBeInTheDocument();
  });
});

describe('dar de alta', () => {
  it('los campos vacíos NO se envían', async () => {
    // Mandar "" a un campo numérico o de fecha produce un 400 críptico sobre un
    // campo que la persona ni tocó.
    const usuario = userEvent.setup();
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Terpelo Panamá');

    await usuario.click(screen.getByRole('button', { name: /Nuevo cliente/ }));
    await rellenar(usuario, screen.getByLabelText(/Nombre/), 'Cliente Nuevo');
    await usuario.click(screen.getByRole('button', { name: /Crear cliente/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalled());
    expect(api.crear).toHaveBeenCalledWith('/clientes', { nombre: 'Cliente Nuevo' });
  });

  it('los campos numéricos viajan como número, no como texto', async () => {
    const usuario = userEvent.setup();
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Terpelo Panamá');

    await usuario.click(screen.getByRole('button', { name: /Nuevo cliente/ }));
    await rellenar(usuario, screen.getByLabelText(/Nombre/), 'Con cupo');
    await rellenar(usuario, screen.getByLabelText(/Cupo/), '250');
    await usuario.click(screen.getByRole('button', { name: /Crear cliente/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalled());
    expect(api.crear.mock.calls[0][1]).toEqual({ nombre: 'Con cupo', cupo: 250 });
  });

  it('tras guardar, recarga la lista', async () => {
    const usuario = userEvent.setup();
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Terpelo Panamá');
    expect(api.listar).toHaveBeenCalledTimes(1);

    await usuario.click(screen.getByRole('button', { name: /Nuevo cliente/ }));
    await rellenar(usuario, screen.getByLabelText(/Nombre/), 'X');
    await usuario.click(screen.getByRole('button', { name: /Crear cliente/ }));

    await waitFor(() => expect(api.listar).toHaveBeenCalledTimes(2));
  });

  it('si el servidor rechaza, el formulario SIGUE ABIERTO con lo escrito', async () => {
    // Cerrarlo obligaría a teclearlo todo otra vez para corregir una letra.
    const usuario = userEvent.setup();
    api.crear.mockRejectedValue(new ErrorApi(409, 'Ya existe un cliente con ese RUC'));
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Terpelo Panamá');

    await usuario.click(screen.getByRole('button', { name: /Nuevo cliente/ }));
    await rellenar(usuario, screen.getByLabelText(/Nombre/), 'Duplicado');
    await usuario.click(screen.getByRole('button', { name: /Crear cliente/ }));

    expect(await screen.findByText(/Ya existe un cliente con ese RUC/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre/)).toHaveValue('Duplicado');
  });
});

describe('editar', () => {
  it('rellena el formulario con lo que ya había', async () => {
    const usuario = userEvent.setup();
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Terpelo Panamá');

    const fila = screen.getByRole('row', { name: /Terpelo Panamá/ });
    await usuario.click(within(fila).getByRole('button', { name: /Editar/ }));
    expect(screen.getByLabelText(/Nombre/)).toHaveValue('Terpelo Panamá');
  });

  it('recorta la fecha ISO a lo que el input de fecha entiende', async () => {
    // La API devuelve `2026-03-01T10:20:30.000Z` y un `input type=date` sólo
    // acepta `YYYY-MM-DD`: sin el recorte el campo aparece vacío y guardar
    // borraría la fecha sin que nadie lo pidiera.
    const usuario = userEvent.setup();
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Terpelo Panamá');

    const fila = screen.getByRole('row', { name: /Terpelo Panamá/ });
    await usuario.click(within(fila).getByRole('button', { name: /Editar/ }));
    expect(screen.getByLabelText(/Fecha de alta/)).toHaveValue('2026-03-01');
  });

  it('los campos de sólo alta quedan deshabilitados', async () => {
    const usuario = userEvent.setup();
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Terpelo Panamá');

    const fila = screen.getByRole('row', { name: /Terpelo Panamá/ });
    await usuario.click(within(fila).getByRole('button', { name: /Editar/ }));
    expect(screen.getByLabelText(/RUC/)).toBeDisabled();
    expect(screen.getByLabelText(/Nombre/)).not.toBeDisabled();
  });

  it('guarda con PATCH sobre el id correcto, no crea uno nuevo', async () => {
    const usuario = userEvent.setup();
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Terpelo Panamá');

    const fila = screen.getByRole('row', { name: /Terpelo Panamá/ });
    await usuario.click(within(fila).getByRole('button', { name: /Editar/ }));
    await usuario.click(screen.getByRole('button', { name: /Guardar cambios/ }));

    await waitFor(() => expect(api.actualizar).toHaveBeenCalled());
    expect(api.actualizar.mock.calls[0][0]).toBe('/clientes/1');
    expect(api.crear).not.toHaveBeenCalled();
  });

  it('un valor nulo se edita como campo vacío, no como «null»', async () => {
    const usuario = userEvent.setup();
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Sin RUC');

    const fila = screen.getByRole('row', { name: /Sin RUC/ });
    await usuario.click(within(fila).getByRole('button', { name: /Editar/ }));
    expect(screen.getByLabelText(/RUC/)).toHaveValue('');
  });
});

describe('dar de baja', () => {
  it('pregunta antes, y si se cancela no llama a nada', async () => {
    const usuario = userEvent.setup();
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Terpelo Panamá');

    const fila = screen.getByRole('row', { name: /Terpelo Panamá/ });
    await usuario.click(within(fila).getByRole('button', { name: /Dar de baja/ }));
    expect(api.desactivar).not.toHaveBeenCalled();
  });

  it('la pregunta NOMBRA el registro, no dice «¿seguro?»', async () => {
    // Con seis botones iguales en pantalla, un «¿seguro?» sin nombre es como no
    // preguntar: quien se equivocó de fila confirma igual.
    const usuario = userEvent.setup();
    const confirmar = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Terpelo Panamá');

    const fila = screen.getByRole('row', { name: /Terpelo Panamá/ });
    await usuario.click(within(fila).getByRole('button', { name: /Dar de baja/ }));
    expect(confirmar.mock.calls[0][0]).toContain('Terpelo Panamá');
  });

  it('al aceptar, da de baja y recarga', async () => {
    const usuario = userEvent.setup();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Terpelo Panamá');

    const fila = screen.getByRole('row', { name: /Terpelo Panamá/ });
    await usuario.click(within(fila).getByRole('button', { name: /Dar de baja/ }));
    await waitFor(() => expect(api.desactivar).toHaveBeenCalledWith('/clientes/1'));
    await waitFor(() => expect(api.listar).toHaveBeenCalledTimes(2));
  });

  it('si el servidor lo impide, lo explica', async () => {
    const usuario = userEvent.setup();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    api.desactivar.mockRejectedValue(
      new ErrorApi(409, 'El vehículo tiene una cisterna asociada; da de baja la cisterna primero'));
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Terpelo Panamá');

    const fila = screen.getByRole('row', { name: /Terpelo Panamá/ });
    await usuario.click(within(fila).getByRole('button', { name: /Dar de baja/ }));
    expect(await screen.findByText(/da de baja la cisterna primero/)).toBeInTheDocument();
  });
});

describe('accesibilidad de la tabla', () => {
  it('cada botón de acción dice a QUÉ fila pertenece', async () => {
    // Sin esto, seis botones «Editar» son indistinguibles para quien navega con
    // lector de pantalla. Es también por lo que los recorridos e2e usan
    // `exact:true` al buscar celdas.
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Terpelo Panamá');
    expect(screen.getByRole('button', { name: /Editar Terpelo Panamá/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dar de baja Terpelo Panamá/ })).toBeInTheDocument();
  });

  it('las cabeceras de columna son cabeceras de verdad', async () => {
    render(<Catalogo def={DEF} />);
    await screen.findAllByText('Terpelo Panamá');
    expect(screen.getByRole('columnheader', { name: 'Nombre' })).toBeInTheDocument();
  });
});
