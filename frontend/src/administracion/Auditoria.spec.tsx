import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Auditoria } from './Auditoria';
import { ErrorApi } from '@/api/cliente';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { listar: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as { api: { listar: jest.Mock } };

/*
 * §21 · La bitácora de auditoría.
 *
 * `GET /auditoria` es de SÓLO LECTURA a propósito: no existe endpoint para
 * escribir en ella, lo que llega lo pone el interceptor global. Y no tenía
 * pantalla, así que la bitácora que el §21 exige llevar no se podía consultar
 * más que con SQL.
 *
 * LO QUE ESTA PANTALLA AÑADE SOBRE LA API
 *
 * Traducir `valorAnterior` y `valorNuevo` —dos objetos JSON— a **qué cambió**.
 * Volcar el JSON en una celda es enseñar el dato sin responder la pregunta que
 * trae quien abre una auditoría, que siempre es la misma: qué se tocó, quién y
 * por qué.
 */

const REGISTROS = [
  { id: 'a1', accion: 'actualizar', entidad: 'usuarios', entidadId: 'u2',
    usuarioId: '1', motivo: 'Dejó la empresa el 2026-09-10',
    valorAnterior: { estado: 'activo' }, valorNuevo: { estado: 'suspendido' },
    ip: '10.0.0.5', ruta: 'PATCH /usuarios/u2/suspender',
    ocurridoEn: '2026-09-11T14:03:00Z' },
  { id: 'a2', accion: 'crear', entidad: 'clientes', entidadId: 'c9',
    usuarioId: '1', motivo: null,
    valorAnterior: null, valorNuevo: { nombre: 'Terpelo', estado: 'activo' },
    ip: '10.0.0.5', ruta: 'POST /clientes',
    ocurridoEn: '2026-09-11T13:00:00Z' },
];

beforeEach(() => { jest.clearAllMocks(); api.listar.mockResolvedValue(REGISTROS); });

const filaDe = (t: string) => screen.getByRole('row', { name: new RegExp(t) });

describe('qué cambió', () => {
  it('un cambio se lee como «de X a Y», no como dos JSON', async () => {
    render(<Auditoria />);
    await screen.findByText(/PATCH \/usuarios/);
    expect(filaDe('PATCH /usuarios')).toHaveTextContent(/estado.*activo.*→.*suspendido/);
  });

  it('un alta enseña lo que se creó, sin inventar un «anterior»', async () => {
    // `valorAnterior: null` es lo normal en una creación. Pintar «null → X»
    // sugiere que había algo antes y que valía «null».
    render(<Auditoria />);
    await screen.findByText(/POST \/clientes/);
    const fila = filaDe('POST /clientes');
    expect(fila).toHaveTextContent(/nombre.*Terpelo/);
    expect(fila).not.toHaveTextContent(/null/);
  });

  it('el motivo se ve, porque es lo que el §21 pide guardar', async () => {
    render(<Auditoria />);
    await screen.findByText(/PATCH \/usuarios/);
    expect(filaDe('PATCH /usuarios')).toHaveTextContent(/Dejó la empresa/);
  });

  it('sin motivo no inventa uno', async () => {
    render(<Auditoria />);
    await screen.findByText(/POST \/clientes/);
    expect(filaDe('POST \\/clientes')).toHaveTextContent(/—/);
  });
});

describe('los filtros', () => {
  it('por omisión pide el tope documentado y sin filtros', async () => {
    render(<Auditoria />);
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/auditoria?limite=100'));
  });

  it('filtrar por entidad va en la consulta, no en el navegador', async () => {
    /* La API tope a 500 registros: filtrar en el cliente enseñaría «los
       usuarios que aparecen en los últimos 100 cambios», que no es lo mismo que
       «los últimos 100 cambios sobre usuarios» y se parece lo justo para que
       nadie lo note. */
    const usuario = userEvent.setup();
    render(<Auditoria />);
    await screen.findByText(/PATCH \/usuarios/);
    await usuario.selectOptions(screen.getByLabelText(/Entidad/), 'usuarios');
    await waitFor(() => expect(api.listar)
      .toHaveBeenCalledWith('/auditoria?limite=100&entidad=usuarios'));
  });

  it('el tope se puede subir hasta el máximo que acepta la API', async () => {
    const usuario = userEvent.setup();
    render(<Auditoria />);
    await screen.findByText(/PATCH \/usuarios/);
    await usuario.selectOptions(screen.getByLabelText(/Cuántos/), '500');
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/auditoria?limite=500'));
  });
});

describe('es de sólo lectura, y se nota', () => {
  it('no ofrece ni un botón que escriba', async () => {
    /* No hay endpoint para escribir en la bitácora: lo que llega lo pone el
       interceptor. Un botón de editar o borrar aquí no fallaría —no existiría
       siquiera la llamada— pero sugeriría que una auditoría es algo que se
       puede retocar, que es justo lo contrario de para qué existe. */
    render(<Auditoria />);
    await screen.findByText(/PATCH \/usuarios/);
    /* `queryAll` y no `getAll`: hoy esta pantalla no tiene NINGÚN botón, y
       `getAllByRole` lanza cuando no encuentra ninguno — la prueba habría
       fallado por cumplirse del todo. La afirmación sigue valiendo el día que
       se añada un botón legítimo (exportar, por ejemplo). */
    for (const b of screen.queryAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(/borrar|eliminar|editar|anular/i);
    }
  });
});

describe('cuando no hay o no se puede', () => {
  it('sin registros lo dice', async () => {
    api.listar.mockResolvedValue([]);
    render(<Auditoria />);
    expect(await screen.findByText(/Ningún movimiento/i)).toBeInTheDocument();
  });

  it('un 403 se explica: este permiso no lo tiene cualquiera', async () => {
    api.listar.mockRejectedValue(new ErrorApi(403, 'No tienes permiso para leer la auditoría'));
    render(<Auditoria />);
    expect(await screen.findByText(/No tienes permiso para leer la auditoría/)).toBeInTheDocument();
  });
});

describe('de dónde vino cada cambio', () => {
  it('enseña la IP y la ruta, que es lo que permite rastrear', async () => {
    render(<Auditoria />);
    await screen.findByText(/PATCH \/usuarios/);
    expect(within(filaDe('PATCH /usuarios')).getByText('10.0.0.5')).toBeInTheDocument();
  });
});

describe('los cambios que no son un simple «de X a Y»', () => {
  /* `describirCambio` recorre la UNIÓN de las claves de los dos lados, y cada
     una de estas formas sale de un caso real de la bitácora. Se prueban por la
     pantalla y no llamando a la función: lo que importa es lo que acaba
     leyendo quien audita. */
  const registro = (extra: Record<string, unknown>) => ({
    id: 'x', accion: 'actualizar', entidad: 'viajes', entidadId: 'v1',
    usuarioId: '1', motivo: null, ip: '10.0.0.9', ruta: 'PATCH /viajes/v1',
    ocurridoEn: '2026-09-11T14:03:00Z', ...extra,
  });

  it('un campo que DESAPARECE se dice, no se omite', async () => {
    // Quitar un campo es un cambio; enseñar sólo las claves del valor nuevo lo
    // haría invisible, que es la peor forma de perder algo en una auditoría.
    api.listar.mockResolvedValue([registro({
      valorAnterior: { conductorId: '7' }, valorNuevo: {} })]);
    render(<Auditoria />);
    expect(await screen.findByText(/conductorId.*7.*quitado/)).toBeInTheDocument();
  });

  it('un campo que NO cambió se enseña una sola vez, sin flecha', async () => {
    // Una flecha entre dos valores iguales invita a buscar la diferencia.
    api.listar.mockResolvedValue([registro({
      valorAnterior: { estado: 'cargando', nota: 'igual' },
      valorNuevo:    { estado: 'en_transito', nota: 'igual' } })]);
    render(<Auditoria />);
    const celda = await screen.findByText(/estado/);
    expect(celda).toHaveTextContent('nota: igual');
    expect(celda).toHaveTextContent(/estado: cargando → en_transito/);
  });

  it('un valor que es un objeto se enseña entero, no como «[object Object]»', async () => {
    api.listar.mockResolvedValue([registro({
      valorAnterior: null, valorNuevo: { geo: { lat: 9.1, lng: -79.5 } } })]);
    render(<Auditoria />);
    expect(await screen.findByText(/"lat":9\.1/)).toBeInTheDocument();
  });

  it('un registro sin valores no inventa un cambio', async () => {
    // Pasa con acciones que no tocan campos, como una consulta auditada.
    api.listar.mockResolvedValue([registro({ valorAnterior: null, valorNuevo: null })]);
    render(<Auditoria />);
    await screen.findByText(/PATCH \/viajes/);
    expect(screen.getByRole('row', { name: /PATCH \/viajes/ })).toHaveTextContent('—');
  });

  it('un fallo que no viene de la API tampoco se traga', async () => {
    // Sin red, `fetch` lanza un TypeError y no un ErrorApi: el mensaje genérico
    // es lo único honesto que se puede decir.
    api.listar.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Auditoria />);
    expect(await screen.findByText(/No se pudo leer la auditoría/)).toBeInTheDocument();
  });
});
