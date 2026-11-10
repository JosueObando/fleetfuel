import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PanelEjecutivo } from './PanelEjecutivo';
import { ErrorApi } from '@/api/cliente';
import { navegaciones, reemplazos, reiniciarUrl } from '../../../pruebas/router';

jest.mock('next/navigation', () => jest.requireActual('../../../pruebas/router'));
jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { obtener: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as { api: Record<'obtener', jest.Mock> };

/*
 * §15.1 · Dashboard ejecutivo.
 *
 * Los NÚMEROS los prueba el backend (`informes.integracion.ts`, con datos de
 * resultado conocido). Aquí va lo que la pantalla decide: qué tarjeta enseña
 * qué, cuándo dice de dónde sale un dato, a dónde lleva cada tarjeta que pide
 * una acción, el día en la URL y qué pasa cuando la red falla.
 */

/* La forma de `GET /informes/ejecutivo`: `count(*)` y `numeric` llegan de
   Postgres como CADENAS, así que así se simulan (trampa 6 de las pruebas). */
const EJECUTIVO = {
  fecha: '2033-03-15',
  ordenesActivas: '14', viajesEnCurso: '3', volumenEntregado: '12500.50',
  kilometrosGps: '0', unidadesConGps: '0', kilometrosOdometro: '320.00',
  gastosDelDia: '40.00', gastosPorAprobar: '1',
  conductoresPendientesPago: '2', montoPendientePago: '180.00',
  alertasCriticas: '2', alertasAltas: '1',
};

const tarjeta = async (rotulo: string) => (await screen.findByText(rotulo)).closest('div')!;

function aplazado<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>(res => { resolver = res; });
  return { promesa, resolver };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  reiniciarUrl('/operacion/panel');
  api.obtener.mockResolvedValue(EJECUTIVO);
});

describe('las ocho tarjetas del §15.1', () => {
  it('pide el día de hoy y enseña las ocho, en el orden del PRD', async () => {
    render(<PanelEjecutivo />);
    await screen.findByText('14');
    expect(api.obtener).toHaveBeenCalledWith('/informes/ejecutivo');
    const rotulos = ['Órdenes activas', 'Viajes en curso', 'Volumen entregado',
      'Kilómetros del día', 'Gastos del día', 'Margen promedio',
      'Conductores pendientes de pago', 'Alertas críticas'];
    const enPantalla = screen.getAllByText(new RegExp(`^(${rotulos.join('|')})$`))
      .map(n => n.textContent);
    expect(enPantalla).toEqual(rotulos);
  });

  it('pone cada dato en su tarjeta, con formato', async () => {
    render(<PanelEjecutivo />);
    expect(within(await tarjeta('Órdenes activas')).getByText('14')).toBeInTheDocument();
    expect(within(await tarjeta('Viajes en curso')).getByText('3')).toBeInTheDocument();
    expect(within(await tarjeta('Volumen entregado')).getByText('12,500.5 L')).toBeInTheDocument();
  });

  it('el margen promedio NO inventa un número: dice qué le falta', async () => {
    // Sin ingreso ni costo completo (Fase 3), cualquier porcentaje sería una
    // cifra que parece la respuesta y no lo es.
    render(<PanelEjecutivo />);
    const margen = await tarjeta('Margen promedio');
    expect(within(margen).getByText('—')).toBeInTheDocument();
    expect(within(margen).getByText(/motor de costos \(Fase 3\)/)).toBeInTheDocument();
  });

  describe('kilómetros: dice de qué medida salen', () => {
    it('con GPS, los del GPS y de cuántas unidades', async () => {
      api.obtener.mockResolvedValue({ ...EJECUTIVO, kilometrosGps: '412.346', unidadesConGps: '4' });
      render(<PanelEjecutivo />);
      const km = await tarjeta('Kilómetros del día');
      expect(within(km).getByText('412.3 km')).toBeInTheDocument();
      expect(within(km).getByText('por GPS, de 4 unidades')).toBeInTheDocument();
    });

    it('con una sola unidad, en singular', async () => {
      api.obtener.mockResolvedValue({ ...EJECUTIVO, kilometrosGps: '12', unidadesConGps: '1' });
      render(<PanelEjecutivo />);
      expect(within(await tarjeta('Kilómetros del día')).getByText('por GPS, de 1 unidad'))
        .toBeInTheDocument();
    });

    it('sin GPS, los del odómetro, y lo dice', async () => {
      // Sin la app del conductor casi no llega GPS. Un 0 todos los días no
      // informaría de nada; el odómetro sí, siempre que se sepa que es él.
      render(<PanelEjecutivo />);
      const km = await tarjeta('Kilómetros del día');
      expect(within(km).getByText('320 km')).toBeInTheDocument();
      expect(within(km).getByText('por odómetro de los viajes cerrados; ninguna unidad envió GPS'))
        .toBeInTheDocument();
      expect(within(km).queryByText(/por GPS/)).not.toBeInTheDocument();
    });
  });

  it('gastos: el importe, cuántos esperan aprobación y lo que NO incluyen', async () => {
    render(<PanelEjecutivo />);
    const gastos = await tarjeta('Gastos del día');
    expect(within(gastos).getByText('40.00')).toBeInTheDocument();
    expect(within(gastos).getByText(/1 por aprobar/)).toBeInTheDocument();
    expect(within(gastos).getByText(/sin combustible del cabezal ni mantenimiento/))
      .toBeInTheDocument();
  });

  it('conductores pendientes de pago: personas, y el importe que se les debe', async () => {
    render(<PanelEjecutivo />);
    const conductores = await tarjeta('Conductores pendientes de pago');
    expect(within(conductores).getByText('2')).toBeInTheDocument();
    expect(within(conductores).getByText('180.00 por pagar')).toBeInTheDocument();
  });

  describe('alertas críticas', () => {
    it('con críticas, lo dice como algo que atender, y cuenta también las altas', async () => {
      render(<PanelEjecutivo />);
      const alertas = await tarjeta('Alertas críticas');
      expect(within(alertas).getByText('2')).toBeInTheDocument();
      expect(within(alertas).getByText('sin resolver · y 1 de severidad alta')).toBeInTheDocument();
    });

    it('sin críticas pero con altas, las altas no desaparecen', async () => {
      // En desarrollo había 0 críticas y 2 altas abiertas: una tarjeta que sólo
      // dijera «0» habría escondido las dos.
      api.obtener.mockResolvedValue({ ...EJECUTIVO, alertasCriticas: '0', alertasAltas: '2' });
      render(<PanelEjecutivo />);
      const alertas = await tarjeta('Alertas críticas');
      expect(within(alertas).getByText('ninguna crítica · 2 de severidad alta')).toBeInTheDocument();
    });

    it('sin ninguna de las dos, lo dice en positivo', async () => {
      api.obtener.mockResolvedValue({ ...EJECUTIVO, alertasCriticas: '0', alertasAltas: '0' });
      render(<PanelEjecutivo />);
      expect(within(await tarjeta('Alertas críticas')).getByText('ninguna crítica ni alta'))
        .toBeInTheDocument();
    });
  });
});

describe('las tarjetas que piden una acción llevan a donde se hace', () => {
  it.each([
    ['Órdenes activas', 'Ver órdenes', '/operacion/ordenes'],
    ['Viajes en curso', 'Ir a despacho', '/operacion/despacho'],
    ['Gastos del día', 'Aprobar gastos', '/operacion/gastos'],
    // Cuenta las por aprobar Y las por pagar: va a la bandeja, no a una pestaña.
    ['Conductores pendientes de pago', 'Ver liquidaciones', '/operacion/liquidaciones'],
    ['Alertas críticas', 'Ver alertas', '/operacion/alertas'],
  ])('%s → %s', async (rotulo, texto, destino) => {
    const usuario = userEvent.setup();
    render(<PanelEjecutivo />);
    const enlace = within(await tarjeta(rotulo)).getByRole('link', { name: texto });
    // El enlace es de verdad: abrirlo en otra pestaña o copiarlo tiene que servir.
    expect(enlace).toHaveAttribute('href', destino);
    await usuario.click(enlace);
    expect(navegaciones).toHaveBeenCalledWith(destino);
  });

  it('el clic navega dentro de la aplicación, sin recargar la página', async () => {
    render(<PanelEjecutivo />);
    const enlace = within(await tarjeta('Alertas críticas')).getByRole('link', { name: 'Ver alertas' });
    // `dispatchEvent` devuelve false cuando alguien canceló la navegación nativa.
    expect(fireEvent.click(enlace)).toBe(false);
  });

  it('con Ctrl o Cmd pulsado se deja al navegador: abrir en otra pestaña', async () => {
    render(<PanelEjecutivo />);
    const enlace = within(await tarjeta('Alertas críticas')).getByRole('link', { name: 'Ver alertas' });
    fireEvent.click(enlace, { ctrlKey: true });
    fireEvent.click(enlace, { metaKey: true });
    expect(navegaciones).not.toHaveBeenCalled();
  });
});

describe('el día vive en la URL', () => {
  it('permite volver a hoy desde una fecha histórica', async () => {
    const usuario = userEvent.setup();
    reiniciarUrl('/operacion/panel?fecha=2033-03-15');
    render(<PanelEjecutivo />);
    await usuario.click(screen.getByRole('button', { name: 'Volver a hoy' }));
    expect(reemplazos).toHaveBeenLastCalledWith('/operacion/panel', { scroll: false });
  });

  it('con ?fecha pide ese día y lo enseña escrito', async () => {
    reiniciarUrl('/operacion/panel?fecha=2033-03-15');
    render(<PanelEjecutivo />);
    expect(await screen.findByText(/15 de marzo de 2033/)).toBeInTheDocument();
    expect(api.obtener).toHaveBeenCalledWith('/informes/ejecutivo?fecha=2033-03-15');
    expect(screen.getByLabelText('Día')).toHaveValue('2033-03-15');
    // Un día elegido no se refresca: decir «actualizado a las…» sugeriría que sí.
    expect(screen.queryByText(/actualizado a las/)).not.toBeInTheDocument();
  });

  it('elegir otro día lo escribe en la URL y pide ese día', async () => {
    const usuario = userEvent.setup();
    render(<PanelEjecutivo />);
    await screen.findByText('14');
    await usuario.type(screen.getByLabelText('Día'), '2033-03-14');
    expect(reemplazos).toHaveBeenLastCalledWith(
      '/operacion/panel?fecha=2033-03-14', { scroll: false });
    await waitFor(() =>
      expect(api.obtener).toHaveBeenCalledWith('/informes/ejecutivo?fecha=2033-03-14'));
  });

  it('borrar el día vuelve a hoy y quita ?fecha', async () => {
    const usuario = userEvent.setup();
    reiniciarUrl('/operacion/panel?fecha=2033-03-15');
    render(<PanelEjecutivo />);
    await screen.findByText('14');
    await usuario.clear(screen.getByLabelText('Día'));
    expect(reemplazos).toHaveBeenLastCalledWith('/operacion/panel', { scroll: false });
  });

  it('al cambiar de día NO enseña las tarjetas del anterior mientras llega el nuevo', async () => {
    const lento = aplazado<typeof EJECUTIVO>();
    api.obtener.mockImplementation((r: string) => r.endsWith('2033-03-14')
      ? lento.promesa : Promise.resolve(EJECUTIVO));
    const usuario = userEvent.setup();
    const { container } = render(<PanelEjecutivo />);
    await screen.findByText('14');
    await usuario.type(screen.getByLabelText('Día'), '2033-03-14');
    // Los 14 de hoy bajo el día 14 serían un dato falso con fecha verdadera.
    expect(screen.queryByText('Órdenes activas')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[class*="esqueleto"]')).toHaveLength(8);
    await act(async () => { lento.resolver({ ...EJECUTIVO, ordenesActivas: '7' }); });
    expect(within(await tarjeta('Órdenes activas')).getByText('7')).toBeInTheDocument();
  });

  it('la respuesta TARDÍA de otro día no pisa la del día que se mira', async () => {
    const lento = aplazado<typeof EJECUTIVO>();
    api.obtener.mockImplementation((r: string) => r.endsWith('2033-03-14')
      ? lento.promesa : Promise.resolve(EJECUTIVO));
    const usuario = userEvent.setup();
    reiniciarUrl('/operacion/panel?fecha=2033-03-14');
    render(<PanelEjecutivo />);
    await usuario.clear(screen.getByLabelText('Día'));
    await usuario.type(screen.getByLabelText('Día'), '2033-03-15');
    await screen.findByText('14');
    // Llega ahora la del 14, con otro número: no puede aparecer.
    await act(async () => { lento.resolver({ ...EJECUTIVO, ordenesActivas: '99' }); });
    expect(screen.queryByText('99')).not.toBeInTheDocument();
    expect(within(await tarjeta('Órdenes activas')).getByText('14')).toBeInTheDocument();
  });
});

describe('carga, error y refresco', () => {
  it('mientras carga enseña esqueletos, no ceros', async () => {
    const lento = aplazado<typeof EJECUTIVO>();
    api.obtener.mockReturnValue(lento.promesa);
    const { container } = render(<PanelEjecutivo />);
    expect(container.querySelectorAll('[aria-hidden="true"][class*="esqueleto"]')).toHaveLength(8);
    expect(screen.queryByText('Órdenes activas')).not.toBeInTheDocument();
    await act(async () => { lento.resolver(EJECUTIVO); });
    expect(container.querySelectorAll('[class*="esqueleto"]')).toHaveLength(0);
  });

  it('si la primera carga falla, lo dice y no enseña tarjetas vacías', async () => {
    api.obtener.mockRejectedValue(new ErrorApi(403, 'No tienes permiso para ver los informes'));
    const { container } = render(<PanelEjecutivo />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para ver los informes');
    expect(screen.queryByText('Órdenes activas')).not.toBeInTheDocument();
    // Ni esqueletos: prometerían unos datos que no van a llegar.
    expect(container.querySelectorAll('[class*="esqueleto"]')).toHaveLength(0);
  });

  it('el error de un día no se queda pegado al elegir otro', async () => {
    const lento = aplazado<typeof EJECUTIVO>();
    api.obtener.mockImplementation((r: string) => r.endsWith('2033-03-14')
      ? Promise.reject(new ErrorApi(500, 'Fallo del 14')) : lento.promesa);
    const usuario = userEvent.setup();
    reiniciarUrl('/operacion/panel?fecha=2033-03-14');
    render(<PanelEjecutivo />);
    await screen.findByRole('alert');
    await usuario.clear(screen.getByLabelText('Día'));
    await usuario.type(screen.getByLabelText('Día'), '2033-03-15');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => { lento.resolver(EJECUTIVO); });
  });

  it('un fallo TARDÍO de otro día no tapa el aviso del día que se mira', async () => {
    let rechazarLento!: (e: unknown) => void;
    api.obtener.mockImplementation((r: string) => r.endsWith('2033-03-14')
      ? new Promise((_, rej) => { rechazarLento = rej; })
      : Promise.reject(new ErrorApi(500, 'Fallo del 15')));
    const usuario = userEvent.setup();
    reiniciarUrl('/operacion/panel?fecha=2033-03-14');
    render(<PanelEjecutivo />);
    await usuario.clear(screen.getByLabelText('Día'));
    await usuario.type(screen.getByLabelText('Día'), '2033-03-15');
    expect(await screen.findByRole('alert')).toHaveTextContent('Fallo del 15');
    await act(async () => { rechazarLento(new ErrorApi(500, 'Fallo del 14')); });
    expect(screen.getByRole('alert')).toHaveTextContent('Fallo del 15');
  });

  it('un fallo que no es de la API da un mensaje propio', async () => {
    api.obtener.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<PanelEjecutivo />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el panel');
  });

  /**
   * Captura el `setInterval` del panel en vez de esperar un minuto de reloj.
   *
   * Sólo los de un minuto: `findBy*` y `waitFor` usan su propio `setInterval`
   * de 50 ms, y capturarlos también dejaría las esperas sin reloj.
   */
  function capturarIntervalo() {
    const realSet = window.setInterval.bind(window);
    const realClear = window.clearInterval.bind(window);
    const registrados: Array<{ fn: () => void; ms: number; id: number }> = [];
    jest.spyOn(window, 'setInterval').mockImplementation(((fn: () => void, ms: number) => {
      if (ms !== 60_000) return realSet(fn, ms);
      const id = 900_000 + registrados.length;
      registrados.push({ fn, ms, id });
      return id;
    }) as typeof setInterval);
    const limpiar = jest.spyOn(window, 'clearInterval').mockImplementation(((id: number) => {
      if (!registrados.some(r => r.id === id)) realClear(id);
    }) as typeof clearInterval);
    return { registrados, limpiar };
  }

  it('HOY se actualiza solo cada minuto (§23) y dice la hora del dato', async () => {
    const { registrados } = capturarIntervalo();
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2033-03-15T14:41:00Z'));
    render(<PanelEjecutivo />);
    expect(await screen.findByText(/actualizado a las 09:41/)).toBeInTheDocument();
    expect(registrados.map(r => r.ms)).toEqual([60_000]);

    api.obtener.mockResolvedValue({ ...EJECUTIVO, ordenesActivas: '15' });
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2033-03-15T14:42:00Z'));
    await act(async () => { registrados[0].fn(); });
    expect(within(await tarjeta('Órdenes activas')).getByText('15')).toBeInTheDocument();
    expect(screen.getByText(/actualizado a las 09:42/)).toBeInTheDocument();
  });

  it('un día elegido NO se refresca: el pasado no cambia cada minuto', async () => {
    const { registrados } = capturarIntervalo();
    reiniciarUrl('/operacion/panel?fecha=2033-03-15');
    render(<PanelEjecutivo />);
    await screen.findByText('14');
    expect(registrados).toHaveLength(0);
  });

  it('al salir de la pantalla deja de refrescar', async () => {
    const { registrados, limpiar } = capturarIntervalo();
    const { unmount } = render(<PanelEjecutivo />);
    await screen.findByText('14');
    unmount();
    expect(limpiar).toHaveBeenCalledWith(registrados[0].id);
  });

  it('si un refresco falla, CONSERVA el último dato y dice de qué hora es', async () => {
    // Vaciar el panel por un corte de red de un minuto sería peor que enseñar
    // datos de hace un minuto sabiendo que lo son.
    const { registrados } = capturarIntervalo();
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2033-03-15T14:41:00Z'));
    render(<PanelEjecutivo />);
    await screen.findByText('14');

    api.obtener.mockRejectedValue(new TypeError('Failed to fetch'));
    await act(async () => { registrados[0].fn(); });
    expect(screen.getByRole('alert'))
      .toHaveTextContent('No se pudo actualizar el panel: los datos son de las 09:41');
    expect(within(await tarjeta('Órdenes activas')).getByText('14')).toBeInTheDocument();

    // Y cuando vuelve la red, el aviso se va.
    api.obtener.mockResolvedValue(EJECUTIVO);
    await act(async () => { registrados[0].fn(); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
