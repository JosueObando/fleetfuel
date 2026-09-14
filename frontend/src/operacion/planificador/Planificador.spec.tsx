import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Planificador } from './Planificador';
import { ErrorApi } from '@/api/cliente';
import { navegaciones, reemplazos, reiniciarUrl } from '../../../pruebas/router';

jest.mock('next/navigation', () => jest.requireActual('../../../pruebas/router'));
jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { listar: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as { api: Record<'listar', jest.Mock> };

/*
 * §15.3 · La pantalla del planificador. La geometría —dónde cae cada bloque,
 * qué es un conflicto— está en `cronograma.spec.ts`; aquí va lo que sólo existe
 * con React: la semana en la URL, lo que se le pide a la API, cómo se lee cada
 * bloque y los estados de carga.
 */

const CISTERNAS = [{ id: '3', placa: 'CL-003' }, { id: '8', placa: 'CL-008' }];
/* La forma de `GET /viajes` según `CAMPOS`, con `destinos` y `retrasado`. */
const VIAJES = [
  { id: '1', codigoViaje: 'V-001', estado: 'programado', cisternaId: '3', conductorId: '4',
    conductor: 'Ana Pérez', fechaProgramada: '2027-03-02T00:00:00.000Z', fechaInicio: null,
    fechaFin: '2027-03-03T00:00:00.000Z', destinos: ['Estación Norte'], retrasado: false },
  { id: '2', codigoViaje: 'V-002', estado: 'autorizado', cisternaId: '8', conductorId: null,
    conductor: null, fechaProgramada: '2027-03-04T00:00:00.000Z', fechaInicio: null,
    fechaFin: null, destinos: [], retrasado: false },
];
const SEMANA = '/viajes?desde=2027-03-01T00:00:00.000Z&hasta=2027-03-08T00:00:00.000Z';

function aplazado<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>(res => { resolver = res; });
  return { promesa, resolver };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  reiniciarUrl('/operacion/planificador?desde=2027-03-01');
  api.listar.mockImplementation((r: string) =>
    Promise.resolve(r === '/cisternas' ? CISTERNAS : r.startsWith('/viajes') ? VIAJES : []));
});

describe('la semana vive en la URL', () => {
  it('pide a la API SÓLO la semana que dice ?desde', async () => {
    render(<Planificador />);
    await screen.findByRole('link', { name: /V-001/ });
    expect(api.listar).toHaveBeenCalledWith(SEMANA);
    expect(api.listar).toHaveBeenCalledWith('/cisternas');
  });

  it('sin ?desde abre la semana de HOY, desde su lunes', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2027-03-04T15:00:00Z')); // jueves
    reiniciarUrl('/operacion/planificador');
    render(<Planificador />);
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith(SEMANA));
  });

  it('un ?desde que no es una fecha abre la semana de hoy en vez de mandarlo a la API', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2027-03-04T15:00:00Z'));
    reiniciarUrl('/operacion/planificador?desde=ayer');
    render(<Planificador />);
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith(SEMANA));
  });

  it('un ?desde a mitad de semana se lleva a su lunes', async () => {
    reiniciarUrl('/operacion/planificador?desde=2027-03-05');
    render(<Planificador />);
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith(SEMANA));
  });

  it('semana siguiente y anterior reescriben ?desde sin perder el resto', async () => {
    reiniciarUrl('/operacion/planificador?desde=2027-03-01&x=1');
    const usuario = userEvent.setup();
    render(<Planificador />);
    await screen.findByRole('link', { name: /V-001/ });

    await usuario.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    expect(reemplazos).toHaveBeenLastCalledWith('/operacion/planificador?desde=2027-03-08&x=1', { scroll: false });
    await waitFor(() => expect(api.listar)
      .toHaveBeenCalledWith('/viajes?desde=2027-03-08T00:00:00.000Z&hasta=2027-03-15T00:00:00.000Z'));

    await usuario.click(screen.getByRole('button', { name: 'Semana anterior' }));
    await usuario.click(screen.getByRole('button', { name: 'Semana anterior' }));
    expect(reemplazos).toHaveBeenLastCalledWith('/operacion/planificador?desde=2027-02-22&x=1', { scroll: false });
  });

  it('«Esta semana» vuelve al lunes de hoy', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2027-05-12T10:00:00Z')); // miércoles
    const usuario = userEvent.setup();
    render(<Planificador />);
    await screen.findByRole('link', { name: /V-001/ });
    await usuario.click(screen.getByRole('button', { name: 'Esta semana' }));
    expect(reemplazos).toHaveBeenLastCalledWith('/operacion/planificador?desde=2027-05-10', { scroll: false });
  });

  it('la semana se nombra con sus fechas', async () => {
    render(<Planificador />);
    expect(await screen.findByText('Del 1 al 7 de marzo de 2027')).toBeInTheDocument();
  });

  it('y cuando cruza de mes o de año, nombra los dos', async () => {
    reiniciarUrl('/operacion/planificador?desde=2027-03-29');
    const { unmount } = render(<Planificador />);
    expect(await screen.findByText('Del 29 de marzo al 4 de abril de 2027')).toBeInTheDocument();
    unmount();

    reiniciarUrl('/operacion/planificador?desde=2026-12-28');
    render(<Planificador />);
    expect(await screen.findByText('Del 28 de diciembre de 2026 al 3 de enero de 2027')).toBeInTheDocument();
  });
});

describe('el cronograma', () => {
  it('una columna por día y una fila por cisterna, con su placa', async () => {
    render(<Planificador />);
    const tabla = await screen.findByRole('table', { name: 'Viajes por cisterna' });
    const cabeceras = within(tabla).getAllByRole('columnheader').map(c => c.textContent);
    expect(cabeceras).toEqual(['Cisterna', 'lun 1', 'mar 2', 'mié 3', 'jue 4', 'vie 5', 'sáb 6', 'dom 7']);
    expect(within(tabla).getAllByRole('rowheader').map(c => c.textContent)).toEqual(['CL-003', 'CL-008']);
  });

  it('cada bloque se lee entero y lleva al viaje en despacho', async () => {
    render(<Planificador />);
    const bloque = await screen.findByRole('link',
      { name: 'V-001, programado, el 2 de marzo, Ana Pérez, a Estación Norte' });
    expect(bloque).toHaveAttribute('href', '/operacion/despacho?viaje=1');
    expect(within(screen.getByRole('row', { name: /CL-003/ })).getByRole('link')).toBe(bloque);
  });

  it('un viaje sin fin, sin conductor y sin destinos lo dice en su nombre', async () => {
    render(<Planificador />);
    expect(await screen.findByRole('link',
      { name: 'V-002, autorizado, desde el 4 de marzo sin fin previsto, sin conductor, sin destinos' }))
      .toBeInTheDocument();
  });

  it('un viaje de varios días dice del primero al último OCUPADO', async () => {
    api.listar.mockImplementation((r: string) => Promise.resolve(r === '/cisternas' ? CISTERNAS
      : [{ ...VIAJES[0], fechaFin: '2027-03-05T00:00:00.000Z' }]));
    render(<Planificador />);
    expect(await screen.findByRole('link', { name: /^V-001, programado, del 2 al 4 de marzo,/ }))
      .toBeInTheDocument();
  });

  it('un viaje ya arrancado se nombra por su salida REAL', async () => {
    api.listar.mockImplementation((r: string) => Promise.resolve(r === '/cisternas' ? CISTERNAS
      : [{ ...VIAJES[0], estado: 'cargando', fechaProgramada: '2027-03-01T00:00:00.000Z',
           fechaInicio: '2027-03-02T09:00:00.000Z' }]));
    render(<Planificador />);
    expect(await screen.findByRole('link', { name: /^V-001, cargando, el 2 de marzo,/ })).toBeInTheDocument();
  });

  it('el bloque recortado por la semana lo avisa a quien no lo ve', async () => {
    api.listar.mockImplementation((r: string) => Promise.resolve(r === '/cisternas' ? CISTERNAS
      : [{ ...VIAJES[0], fechaProgramada: '2027-02-26T00:00:00.000Z' }]));
    render(<Planificador />);
    expect(await screen.findByRole('link', { name: /empezó antes de esta semana/ })).toBeInTheDocument();
  });

  it('el que sigue después de la semana también lo dice, con su último día', async () => {
    api.listar.mockImplementation((r: string) => Promise.resolve(r === '/cisternas' ? CISTERNAS
      : [{ ...VIAJES[0], fechaProgramada: '2027-03-06T00:00:00.000Z', fechaFin: '2027-03-11T00:00:00.000Z' }]));
    render(<Planificador />);
    expect(await screen.findByRole('link',
      { name: 'V-001, programado, del 6 al 10 de marzo, Ana Pérez, a Estación Norte, sigue después de esta semana' }))
      .toBeInTheDocument();
  });

  it('un viaje que cruza de mes nombra los dos meses', async () => {
    api.listar.mockImplementation((r: string) => Promise.resolve(r === '/cisternas' ? CISTERNAS
      : [{ ...VIAJES[0], fechaProgramada: '2027-02-27T00:00:00.000Z', fechaFin: '2027-03-03T00:00:00.000Z' }]));
    render(<Planificador />);
    expect(await screen.findByRole('link', { name: /^V-001, programado, del 27 de febrero al 2 de marzo,/ }))
      .toBeInTheDocument();
  });

  it('el bloque se coloca en proporción a la semana', async () => {
    render(<Planificador />);
    const bloque = await screen.findByRole('link', { name: /V-001/ });
    expect(bloque.style.left).toMatch(/^14\.28/);
    expect(bloque.style.width).toMatch(/^14\.28/);
  });
});

describe('abrir un viaje', () => {
  it('pulsar un bloque navega DENTRO de la aplicación, sin recargar', async () => {
    const usuario = userEvent.setup();
    render(<Planificador />);
    await usuario.click(await screen.findByRole('link', { name: /^V-001/ }));
    expect(navegaciones).toHaveBeenLastCalledWith('/operacion/despacho?viaje=1');
  });

  it('y pulsar un conflicto, igual', async () => {
    const usuario = userEvent.setup();
    render(<Planificador />);
    await usuario.click((await screen.findAllByRole('link', { name: /V-002 — / }))[0]);
    expect(navegaciones).toHaveBeenLastCalledWith('/operacion/despacho?viaje=2');
  });

  it('con Ctrl o Cmd pulsado lo deja al navegador: abrir en otra pestaña sigue funcionando', async () => {
    const usuario = userEvent.setup();
    render(<Planificador />);
    const bloque = await screen.findByRole('link', { name: /^V-001/ });
    await usuario.keyboard('{Control>}');
    await usuario.click(bloque);
    await usuario.keyboard('{/Control}');
    expect(navegaciones).not.toHaveBeenCalled();
  });
});

describe('los conflictos de asignación', () => {
  it('se listan con cuántos son, y cada uno lleva a su viaje', async () => {
    render(<Planificador />);
    const seccion = await screen.findByRole('region', { name: /Conflictos de asignación/ });
    expect(within(seccion).getByRole('heading')).toHaveTextContent('Conflictos de asignación · 2');
    const enlaces = within(seccion).getAllByRole('link');
    expect(enlaces.map(e => e.textContent)).toEqual([
      'V-002 — sin conductor: no reserva a nadie',
      'V-002 — sin fin previsto: ocupa su cisterna sin límite',
    ]);
    expect(enlaces[0]).toHaveAttribute('href', '/operacion/despacho?viaje=2');
  });

  it('sin conflictos lo dice, en vez de dejar la sección vacía', async () => {
    api.listar.mockImplementation((r: string) => Promise.resolve(r === '/cisternas' ? CISTERNAS : [VIAJES[0]]));
    render(<Planificador />);
    const seccion = await screen.findByRole('region', { name: /Conflictos de asignación/ });
    expect(await within(seccion).findByText('Ningún conflicto en esta semana.')).toBeInTheDocument();
  });
});

describe('cargando, vacío y error', () => {
  it('mientras carga no enseña «ningún conflicto»: todavía no lo sabe', async () => {
    const lento = aplazado<unknown>();
    api.listar.mockImplementation((r: string) => r === '/cisternas' ? Promise.resolve(CISTERNAS) : lento.promesa);
    render(<Planificador />);
    await waitFor(() => expect(api.listar).toHaveBeenCalledWith(SEMANA));
    expect(screen.queryByText('Ningún conflicto en esta semana.')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await act(async () => { lento.resolver([]); await lento.promesa; });
  });

  it('sin cisternas ni viajes lo dice', async () => {
    api.listar.mockResolvedValue([]);
    render(<Planificador />);
    expect(await screen.findByText('No hay cisternas ni viajes que planificar esta semana.')).toBeInTheDocument();
  });

  it('un fallo de la API se explica con su mensaje', async () => {
    api.listar.mockImplementation((r: string) => r === '/cisternas'
      ? Promise.resolve(CISTERNAS) : Promise.reject(new ErrorApi(403, 'Permisos insuficientes. Faltan: viajes:leer')));
    render(<Planificador />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Permisos insuficientes. Faltan: viajes:leer');
    expect(screen.queryByText('Ningún conflicto en esta semana.')).not.toBeInTheDocument();
  });

  it('al cambiar de semana, la anterior NO se enseña mientras llega la nueva', async () => {
    // Durante ese rato, los bloques del lunes 1 bajo el título del lunes 8
    // dirían que la cisterna está ocupada una semana en la que está libre.
    const lenta = aplazado<unknown>();
    api.listar.mockImplementation((r: string) => r === '/cisternas' ? Promise.resolve(CISTERNAS)
      : r === SEMANA ? Promise.resolve(VIAJES) : lenta.promesa);
    const usuario = userEvent.setup();
    render(<Planificador />);
    await screen.findByRole('link', { name: /V-001/ });

    await usuario.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    expect(await screen.findByText('Del 8 al 14 de marzo de 2027')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /V-001/ })).not.toBeInTheDocument();
    await act(async () => { lenta.resolver([]); await lenta.promesa; });
  });

  it('el error de una semana no se queda pegado a la siguiente', async () => {
    api.listar.mockImplementation((r: string) => r === '/cisternas' ? Promise.resolve(CISTERNAS)
      : r === SEMANA ? Promise.reject(new ErrorApi(500, 'Se cayó la consulta')) : Promise.resolve(VIAJES));
    const usuario = userEvent.setup();
    render(<Planificador />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Se cayó la consulta');

    await usuario.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    expect(await screen.findByRole('table', { name: 'Viajes por cisterna' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('la respuesta TARDÍA de la semana anterior no pisa la actual', async () => {
    const lenta = aplazado<unknown>();
    api.listar.mockImplementation((r: string) => r === '/cisternas' ? Promise.resolve(CISTERNAS)
      : r === SEMANA ? lenta.promesa : Promise.resolve([{ ...VIAJES[0], id: '9', codigoViaje: 'V-009',
                                                          fechaProgramada: '2027-03-09T00:00:00.000Z',
                                                          fechaFin: '2027-03-10T00:00:00.000Z' }]));
    const usuario = userEvent.setup();
    render(<Planificador />);
    await usuario.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    expect(await screen.findByRole('link', { name: /V-009/ })).toBeInTheDocument();

    await act(async () => { lenta.resolver(VIAJES); await lenta.promesa; });
    expect(screen.getByRole('link', { name: /V-009/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /V-001/ })).not.toBeInTheDocument();
  });
});
