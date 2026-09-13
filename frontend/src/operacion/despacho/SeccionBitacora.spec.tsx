import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeccionBitacora } from './SeccionBitacora';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { crear: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as { api: { crear: jest.Mock } };

/*
 * §7.15 · La bitácora del viaje.
 *
 * `eventos_viaje` y sus cinco rutas existían desde la Fase 2A —lado servidor—
 * y NINGUNA pantalla las llamaba. La auditoría TDD del 2026-09-12 las encontró
 * con el `grep` de la API viva contra `frontend/src`.
 *
 * LO QUE ESTA SECCIÓN AÑADE SOBRE LA API, Y ES TODO EL PUNTO
 *
 * 1. **Que la verificación de integridad se pueda ver.** La cadena de hashes
 *    existe para demostrarle a alguien que la traza no se tocó; el backend
 *    expuso `/integridad` como ruta propia justamente porque «un hash que nadie
 *    puede comprobar desde fuera no prueba nada a nadie». Sin pantalla, seguía
 *    sin poder comprobarlo nadie.
 *
 * 2. **Que anular NO parezca borrar.** En el §7.15 anular es AÑADIR una
 *    corrección: el evento original sigue ahí. Una pantalla que lo hiciera
 *    desaparecer contaría la historia contraria a la que cuenta la base, y esa
 *    contradicción es la que acaba en «pues yo lo borré y sigue saliendo».
 */

const VIAJE = { id: 'v1', codigoViaje: 'V-001', estado: 'en_transito' };

const EVENTOS = [
  { id: 'e1', tipoEvento: 'salida', fechaHora: '2032-04-01T06:00:00Z', origenDato: 'web',
    observacion: 'Salida de planta', odometro: '120000', anulaEventoId: null },
  { id: 'e2', tipoEvento: 'parada', fechaHora: '2032-04-01T07:30:00Z', origenDato: 'gps',
    observacion: 'Parada no prevista', odometro: '120080', anulaEventoId: null },
  { id: 'e3', tipoEvento: 'correccion', fechaHora: '2032-04-01T08:00:00Z', origenDato: 'web',
    observacion: 'La parada fue un control de pesaje, no una incidencia',
    odometro: null, anulaEventoId: 'e2' },
];

const INTEGRA = { integra: true, eventos: 3, rotoEn: null };
const accion = jest.fn(async (fn: () => Promise<unknown>) => { await fn(); });

beforeEach(() => { jest.clearAllMocks(); api.crear.mockResolvedValue({ id: 'e9' }); });

const pintar = (props: Record<string, unknown> = {}) => render(
  <SeccionBitacora viaje={VIAJE} eventos={EVENTOS} integridad={INTEGRA}
                   accion={accion} {...props} />);

const filaDe = (texto: string) => screen.getByRole('row', { name: new RegExp(texto) });

describe('la traza', () => {
  it('enseña cada evento con su tipo y su hora', () => {
    pintar();
    expect(filaDe('Salida de planta')).toHaveTextContent('salida');
    expect(filaDe('Salida de planta')).toHaveTextContent('06:00');
  });

  it('dice de dónde salió cada dato', () => {
    /* El §7.15 guarda `origen_dato` porque no es lo mismo un evento que puso el
       GPS que uno que tecleó alguien: el segundo depende de quien lo escribió,
       y eso es justo lo que una traza tiene que dejar claro. */
    pintar();
    expect(filaDe('Parada no prevista')).toHaveTextContent('gps');
    expect(filaDe('Salida de planta')).toHaveTextContent('web');
  });

  it('sin eventos lo dice, en vez de una tabla vacía', () => {
    pintar({ eventos: [] });
    expect(screen.getByText(/Sin eventos/i)).toBeInTheDocument();
  });
});

describe('la integridad de la cadena', () => {
  it('cuando está íntegra, lo AFIRMA con el número de eslabones', () => {
    // Un indicador que sólo aparece cuando algo va mal es indistinguible de un
    // indicador roto: quien mira no sabe si está bien o si no se comprobó.
    pintar();
    expect(screen.getByRole('status', { name: /integridad/i })).toHaveTextContent(/íntegra/i);
    expect(screen.getByRole('status', { name: /integridad/i })).toHaveTextContent(/3/);
  });

  it('cuando está rota, dice DÓNDE se rompió', () => {
    /* Lo anterior al eslabón roto sigue valiendo, y por eso el backend devuelve
       el punto exacto en vez de un booleano. Enseñar sólo «rota» tiraría una
       traza entera por un evento. */
    pintar({ integridad: { integra: false, eventos: 3, rotoEn: 'e2' } });
    const aviso = screen.getByRole('status', { name: /integridad/i });
    expect(aviso).toHaveTextContent(/rota/i);
    expect(aviso).toHaveTextContent(/e2/);
  });

  it('si no se pudo comprobar, NO dice que esté íntegra', () => {
    // Sin permiso de lectura o con la API caída, el silencio es honesto y
    // «íntegra» sería una afirmación que nadie ha verificado.
    pintar({ integridad: null });
    expect(screen.queryByText(/íntegra/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no se pudo comprobar/i)).toBeInTheDocument();
  });
});

describe('anular es añadir, no borrar', () => {
  it('el evento anulado SIGUE en la lista, marcado como anulado', () => {
    pintar();
    expect(filaDe('Parada no prevista')).toBeInTheDocument();
    expect(filaDe('Parada no prevista')).toHaveTextContent(/anulado/i);
  });

  it('y la corrección enseña el motivo por el que se anuló', () => {
    pintar();
    expect(filaDe('control de pesaje')).toHaveTextContent(/corrección|correccion/i);
  });

  it('en ninguna parte hay un botón de borrar o eliminar', () => {
    /* La prueba se escribe en negativo a propósito. Es el tipo de botón que
       alguien añade «por comodidad» en una revisión de UI, y sólo aquí queda
       escrito que su ausencia es una decisión del §7.15 y no un olvido. */
    pintar();
    for (const b of screen.getAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(/borrar|eliminar/i);
    }
  });

  it('anular pide un motivo y lo manda al endpoint del evento', async () => {
    const usuario = userEvent.setup();
    pintar();
    await usuario.click(within(filaDe('Salida de planta'))
      .getByRole('button', { name: /Anular/ }));
    await usuario.type(screen.getByLabelText(/Motivo/), 'Se registró con la hora equivocada');
    await usuario.click(screen.getByRole('button', { name: /Confirmar anulación/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalledWith(
      '/eventos/e1/anular', { motivo: 'Se registró con la hora equivocada' }));
  });

  it('sin motivo suficiente no sale la petición', () => {
    // El DTO exige de 5 a 2000 caracteres; dejar que lo rechace el servidor
    // convierte un requisito de auditoría en un error de formulario.
    const usuario = userEvent.setup();
    return (async () => {
      pintar();
      await usuario.click(within(filaDe('Salida de planta'))
        .getByRole('button', { name: /Anular/ }));
      await usuario.type(screen.getByLabelText(/Motivo/), 'ups');
      await usuario.click(screen.getByRole('button', { name: /Confirmar anulación/ }));
      expect(api.crear).not.toHaveBeenCalled();
      expect(await screen.findByText(/al menos 5/i)).toBeInTheDocument();
    })();
  });

  it('un evento YA anulado no se puede anular otra vez', () => {
    // El backend responde 409. Ofrecerlo sería ofrecer un error.
    pintar();
    expect(within(filaDe('Parada no prevista')).queryByRole('button', { name: /Anular/ }))
      .not.toBeInTheDocument();
  });

  it('una corrección tampoco se anula: se corrige con otra', () => {
    pintar();
    expect(within(filaDe('control de pesaje')).queryByRole('button', { name: /Anular/ }))
      .not.toBeInTheDocument();
  });
});

describe('registrar un evento a mano', () => {
  it('manda el tipo y el origen «web», que es lo que es', async () => {
    /* El origen no se elige en un desplegable: lo que se teclea en esta
       pantalla es `web` por definición, y ofrecer «gps» o «sensor» permitiría
       escribir a mano una traza que aparenta venir de un aparato. */
    const usuario = userEvent.setup();
    pintar();
    await usuario.click(screen.getByRole('button', { name: /Registrar evento/ }));
    await usuario.selectOptions(screen.getByLabelText(/Tipo/), 'incidente');
    await usuario.type(screen.getByLabelText(/Observación/), 'Pinchazo en la vía');
    await usuario.click(screen.getByRole('button', { name: /^Registrar$/ }));

    await waitFor(() => expect(api.crear).toHaveBeenCalledWith('/eventos/viaje/v1',
      expect.objectContaining({
        tipoEvento: 'incidente', origenDato: 'web', observacion: 'Pinchazo en la vía',
      })));
  });

  it('no ofrece «corrección» como tipo: esa la crea el servidor al anular', async () => {
    const usuario = userEvent.setup();
    pintar();
    await usuario.click(screen.getByRole('button', { name: /Registrar evento/ }));
    const tipos = within(screen.getByLabelText(/Tipo/)).getAllByRole('option')
      .map(o => o.textContent);
    expect(tipos).not.toContain('correccion');
    expect(tipos).toEqual(expect.arrayContaining(['salida', 'llegada', 'carga']));
  });
});

describe('arrepentirse', () => {
  it('cancelar la anulación no toca la traza', async () => {
    const usuario = userEvent.setup();
    pintar();
    await usuario.click(within(filaDe('Salida de planta'))
      .getByRole('button', { name: /Anular/ }));
    await usuario.type(screen.getByLabelText(/Motivo/), 'Me equivoqué de evento');
    await usuario.click(screen.getByRole('button', { name: /^Cancelar$/ }));

    expect(api.crear).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Confirmar anulación/ })).not.toBeInTheDocument();
  });

  it('cancelar el alta no registra un evento', async () => {
    /* Importa más aquí que en un formulario normal: un evento registrado por
       error no se borra —sólo se anula con otro—, así que la traza se queda con
       los dos para siempre. */
    const usuario = userEvent.setup();
    pintar();
    await usuario.click(screen.getByRole('button', { name: /Registrar evento/ }));
    await usuario.type(screen.getByLabelText(/Observación/), 'me lo estoy pensando');
    await usuario.click(screen.getByRole('button', { name: /^Cancelar$/ }));

    expect(api.crear).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Registrar evento/ })).toBeInTheDocument();
  });
});
