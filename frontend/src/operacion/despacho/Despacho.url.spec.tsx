import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Despacho } from './Despacho';
import { ErrorApi } from '@/api/cliente';
import { irA, reemplazos, reiniciarUrl } from '../../../pruebas/router';

jest.mock('next/navigation', () => jest.requireActual('../../../pruebas/router'));
jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { listar: jest.fn(), obtener: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as { api: Record<'listar' | 'obtener', jest.Mock> };

/*
 * El viaje abierto en despacho vive en la URL (`?viaje=ID`).
 *
 * Despacho acompaña al camión desde la terminal hasta el pago: se deja abierta
 * horas, se recarga y se manda por mensaje («mira el V-001»). Antes la
 * selección era estado de React y se perdía en cada recarga — la auditoría del
 * 2026-09-13 lo encontró porque el plan daba por hecho «el estado de la vista en
 * la URL» y sólo lo cumplían tres pantallas.
 *
 * Fichero aparte de `Despacho.spec.tsx`, que es la suite más lenta y no se engorda.
 */

const VIAJES = [
  { id: '1', codigoViaje: 'V-001', estado: 'cargando' },
  { id: '2', codigoViaje: 'V-002', estado: 'programado' },
];
const viaje = (id: string) => ({
  ...VIAJES.find(v => v.id === id), ordenes: [], planCarga: [], transicionesPosibles: [],
});

function aplazado<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>(res => { resolver = res; });
  return { promesa, resolver };
}

beforeEach(() => {
  jest.clearAllMocks();
  reiniciarUrl('/operacion/despacho');
  api.listar.mockImplementation((r: string) => Promise.resolve(r === '/viajes' ? VIAJES : []));
  api.obtener.mockImplementation((r: string) => {
    const m = r.match(/^\/viajes\/(\d+)$/);
    return m ? Promise.resolve(viaje(m[1])) : Promise.reject(new ErrorApi(404, 'no'));
  });
});

const titulo = (codigo: string) => screen.findByRole('heading', { level: 2, name: codigo });

it('elegir un viaje lo escribe en la URL sin perder el resto de la consulta', async () => {
  reiniciarUrl('/operacion/despacho?origen=alertas');
  const usuario = userEvent.setup();
  render(<Despacho />);

  await usuario.click(await screen.findByRole('button', { name: /V-002/ }));

  expect(reemplazos).toHaveBeenCalledWith('/operacion/despacho?origen=alertas&viaje=2', { scroll: false });
  expect(await titulo('V-002')).toBeInTheDocument();
});

it('al entrar con ?viaje=ID abre ese viaje sin tocar nada', async () => {
  // Es lo que hace que recargar, o abrir un enlace compartido, vuelva al mismo sitio.
  reiniciarUrl('/operacion/despacho?viaje=2');
  render(<Despacho />);

  expect(await titulo('V-002')).toBeInTheDocument();
  expect(api.obtener).toHaveBeenCalledWith('/viajes/2');
  expect(screen.getByRole('button', { name: /V-002/ })).toHaveAttribute('aria-pressed', 'true');
});

it('sin ?viaje no abre ninguno: nunca se autoselecciona', async () => {
  render(<Despacho />);
  await screen.findByRole('button', { name: /V-001/ });
  expect(screen.getByText(/Selecciona un viaje/)).toBeInTheDocument();
  expect(api.obtener).not.toHaveBeenCalled();
});

it('un enlace a un viaje que no se puede abrir lo dice', async () => {
  api.obtener.mockRejectedValue(new ErrorApi(404, 'Viaje no encontrado'));
  reiniciarUrl('/operacion/despacho?viaje=99');
  render(<Despacho />);

  expect(await screen.findByText('Viaje no encontrado')).toBeInTheDocument();
  expect(screen.getByText(/Selecciona un viaje/)).toBeInTheDocument();
});

it('abrir un viaje bueno después de un enlace roto quita el aviso', async () => {
  // El aviso del 404 hablaba de OTRO viaje: dejarlo sobre el detalle del
  // nuevo diría que éste no se pudo abrir.
  api.obtener.mockImplementation((r: string) => r === '/viajes/99'
    ? Promise.reject(new ErrorApi(404, 'Viaje no encontrado')) : Promise.resolve(viaje('1')));
  reiniciarUrl('/operacion/despacho?viaje=99');
  const usuario = userEvent.setup();
  render(<Despacho />);
  expect(await screen.findByText('Viaje no encontrado')).toBeInTheDocument();

  await usuario.click(screen.getByRole('button', { name: /V-001/ }));
  expect(await titulo('V-001')).toBeInTheDocument();
  expect(screen.queryByText('Viaje no encontrado')).not.toBeInTheDocument();
});

it('la respuesta TARDÍA del viaje anterior no pisa al que dice la URL', async () => {
  // Quien pulsa dos viajes seguidos lanza dos peticiones, y la red no respeta
  // el orden. Antes nada lo impedía: la última en llegar se quedaba la pantalla.
  const lento = aplazado<unknown>();
  api.obtener.mockImplementation((r: string) =>
    r === '/viajes/1' ? lento.promesa : Promise.resolve(viaje('2')));
  reiniciarUrl('/operacion/despacho?viaje=1');
  render(<Despacho />);
  await waitFor(() => expect(api.obtener).toHaveBeenCalledWith('/viajes/1'));

  act(() => irA('/operacion/despacho?viaje=2'));
  expect(await titulo('V-002')).toBeInTheDocument();

  // Dentro de `act`: con un `waitFor`, «V-002» ya está en pantalla y la
  // afirmación correría antes de que React aplicara la respuesta tardía.
  await act(async () => { lento.resolver(viaje('1')); await lento.promesa; });
  expect(screen.getByRole('heading', { level: 2, name: 'V-002' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 2, name: 'V-001' })).not.toBeInTheDocument();
});

it('quitar ?viaje de la URL cierra el detalle', async () => {
  // Volver con el botón «atrás» del navegador tiene que deshacer la selección.
  reiniciarUrl('/operacion/despacho?viaje=1');
  render(<Despacho />);
  expect(await titulo('V-001')).toBeInTheDocument();

  act(() => irA('/operacion/despacho'));
  await waitFor(() => expect(screen.getByText(/Selecciona un viaje/)).toBeInTheDocument());
});

it('«Volver a la lista» quita ?viaje de la URL: en un teléfono, lista y detalle se turnan', async () => {
  /* Spec §7, <1024: maestro/detalle conmutado. Volver es quitar la selección de
     la URL, así que el botón «atrás» del navegador y éste hacen lo mismo. */
  reiniciarUrl('/operacion/despacho?origen=alertas&viaje=1');
  const usuario = userEvent.setup();
  const { container } = render(<Despacho />);
  expect(await titulo('V-001')).toBeInTheDocument();
  expect(container.querySelector('[data-vista]')).toHaveAttribute('data-vista', 'detalle');

  await usuario.click(screen.getByRole('button', { name: 'Volver a la lista' }));
  expect(reemplazos).toHaveBeenLastCalledWith('/operacion/despacho?origen=alertas', { scroll: false });
  await waitFor(() => expect(container.querySelector('[data-vista]')).toHaveAttribute('data-vista', 'lista'));
  expect(screen.getByRole('button', { name: /V-001/ })).toHaveFocus();
});
