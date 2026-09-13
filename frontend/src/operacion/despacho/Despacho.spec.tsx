import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Despacho } from './Despacho';
import { ErrorApi } from '@/api/cliente';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: {
    listar: jest.fn(), obtener: jest.fn(), crear: jest.fn(),
    actualizar: jest.fn(), desactivar: jest.fn(),
  } };
});
const { api } = jest.requireMock('@/api/cliente') as {
  api: Record<'listar' | 'obtener' | 'crear' | 'actualizar' | 'desactivar', jest.Mock>;
};

/*
 * La pantalla de despacho y cierre: la Fase 1C llevada a la interfaz.
 *
 * Todo 1C cuelga del VIAJE —una carga, una entrega, un gasto y una liquidación
 * son siempre de un viaje concreto—, así que no son cuatro pantallas sino
 * cuatro momentos de la misma, y cuál está abierto lo decide la máquina de
 * estados del §8.2. Eso es lo que se fija aquí.
 *
 * LO QUE MÁS IMPORTA DE ESTE FICHERO
 *
 * Que la interfaz NO ofrezca declarar un precinto «intacto». La regla 18 dice
 * que el sello se verifica contra el de la carga, y el backend lo hace desde el
 * 2026-09-12: la coincidencia la decide el sistema. Un desplegable con
 * «intacto / roto / inconsistente» en la pantalla contaría otra historia —que
 * la palabra de quien recibe zanja el asunto— y esa contradicción entre lo que
 * la pantalla sugiere y lo que el servidor hace es la que acaba en «el sistema
 * está mal, me deja poner intacto y luego lo cambia».
 */

const VIAJES = [
  { id: '1', codigoViaje: 'V-001', estado: 'cargando', conductor: 'Ana Pérez',
    fechaProgramada: '2032-04-01T06:00:00Z' },
];

const viaje = (extra: Record<string, unknown> = {}) => ({
  id: '1', codigoViaje: 'V-001', estado: 'cargando', conductor: 'Ana Pérez',
  cisternaId: '9', kilometrosGps: 120,
  ordenes: [{ id: 'vo1', ordenId: '5', secuencia: 1, estacion: 'Estación Norte' }],
  planCarga: [{ id: 'p1', compartimentoId: 'c1', compartimento: 1, producto: 'Diésel',
                detalleOrdenId: 'd1', volumenPlanificado: '3000.00',
                capacidadCalibrada: '4980.00' }],
  ...extra,
});

const CARGA = {
  id: 'g1', compartimentoId: 'c1', detalleOrdenId: 'd1',
  volumenProgramado: '3000.00', volumenCargado: '2990.00',
  diferenciaProgramado: '-10.00', numeroSello: 'SELLO-77',
  operadorTerminal: 'Luis', estadoValidacion: 'pendiente',
};

const ENTREGA = {
  id: 'e1', compartimentoId: 'c1', cargaId: 'g1', volumenCargado: '2990.00',
  volumenRecibido: '2985.00', porcentajeMerma: '0.1672', diferenciaVolumen: '5.00',
  selloRecibido: 'SELLO-77', estadoSello: 'intacto', estado: 'aceptada',
  receptorNombre: 'Marta',
};

const GASTO = {
  id: 'x1', categoria: 'peaje', descripcion: 'Peajes', monto: '18.75',
  pagadoPor: 'conductor', reembolsable: true, estado: 'pendiente', registrante: 'Ana',
};

const LIQUIDACION = {
  id: 'l1', codigoViaje: 'V-001', conductor: 'Ana Pérez', estado: 'pendiente',
  tarifaBase: '0.00', pagoKilometros: '24.00', pagoEntregas: '10.00',
  reembolsos: '18.75', viaticos: '0.00', bonificaciones: '0.00', penalizaciones: '0.00',
  totalPagar: '52.75', kilometros: '120.00', entregasContadas: 2,
};

/** Respuestas por defecto: viaje cargando, una carga, sin entregas ni gastos. */
function conApi(opciones: {
  estado?: string; cargas?: unknown[]; entregas?: unknown[];
  gastos?: unknown[]; liquidacion?: unknown | null;
} = {}) {
  const { estado = 'cargando', cargas = [], entregas = [], gastos = [] } = opciones;
  api.listar.mockImplementation((r: string) => {
    if (r === '/viajes') return Promise.resolve(VIAJES.map(v => ({ ...v, estado })));
    if (r.startsWith('/cargas/viaje/')) return Promise.resolve(cargas);
    if (r.startsWith('/entregas/viaje/')) return Promise.resolve(entregas);
    if (r.startsWith('/gastos/viaje/')) return Promise.resolve(gastos);
    return Promise.resolve([]);
  });
  api.obtener.mockImplementation((r: string) => {
    if (r === '/viajes/1') return Promise.resolve(viaje({ estado }));
    // La tolerancia vive en la LINEA de la orden, no en el viaje: la pantalla
    // la busca igual que hace la de viajes para las lineas planificables.
    if (r === '/ordenes/5') return Promise.resolve({
      id: '5', numeroOrdenExterna: 'OC-9', detalles: [
        { id: 'd1', producto: 'Diésel', tolerancia: '1.00',
          volumenSolicitado: '6000.00', volumenPendiente: '3000.00' }] });
    if (r.endsWith('/totales')) return Promise.resolve({ totalAprobado: '0.00', totalPendiente: '0.00' });
    if (r.startsWith('/liquidaciones/viaje/')) {
      return opciones.liquidacion
        ? Promise.resolve(opciones.liquidacion)
        : Promise.reject(new ErrorApi(404, 'Ese viaje todavía no está liquidado'));
    }
    return Promise.resolve({});
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.crear.mockResolvedValue({ id: 'nuevo' });
  api.actualizar.mockResolvedValue({});
  api.desactivar.mockResolvedValue(undefined);
  conApi();
});

async function abrirViaje(usuario: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('V-001');
  await usuario.click(screen.getByText('V-001'));
  await waitFor(() => expect(api.obtener).toHaveBeenCalledWith('/viajes/1'));
}

/* ─────────────────────────────────────────────────────────────────────────
 * La máquina de estados decide qué momento está abierto
 * ───────────────────────────────────────────────────────────────────────── */
describe('qué se puede hacer depende del estado del viaje (§8.2)', () => {
  it('con el viaje CARGANDO se ofrece registrar la carga en terminal', async () => {
    const usuario = userEvent.setup();
    render(<Despacho />);
    await abrirViaje(usuario);
    expect(await screen.findByRole('button', { name: /Registrar carga/i })).toBeInTheDocument();
  });

  it('con el viaje CARGANDO todavía no se puede registrar una entrega', async () => {
    // La Etapa 7 del §9 no ha llegado: el camión ni siquiera ha salido de la
    // terminal. Ofrecer el formulario invitaría a un 409 del servidor.
    const usuario = userEvent.setup();
    render(<Despacho />);
    await abrirViaje(usuario);
    await screen.findByRole('button', { name: /Registrar carga/i });
    expect(screen.queryByRole('button', { name: /Registrar entrega/i })).not.toBeInTheDocument();
  });

  it('con el viaje DESCARGANDO se ofrece la entrega y ya no la carga', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'descargando', cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);
    expect(await screen.findByRole('button', { name: /Registrar entrega/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar carga/i })).not.toBeInTheDocument();
  });

  it('con el viaje CERRADO se ofrece calcular la liquidación', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'cerrado', cargas: [CARGA], entregas: [ENTREGA] });
    render(<Despacho />);
    await abrirViaje(usuario);
    expect(await screen.findByRole('button', { name: /Calcular liquidación/i })).toBeInTheDocument();
  });

  it('sin cerrar el viaje, la liquidación dice por qué no se puede todavía', async () => {
    // Regla 12: no se paga una liquidación sin el viaje cerrado. Decirlo aquí
    // ahorra el viaje de ida y vuelta al 409.
    const usuario = userEvent.setup();
    conApi({ estado: 'descargando', cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);
    expect(await screen.findByText(/se liquida cuando el viaje está cerrado/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Calcular liquidación/i })).not.toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * La regla 18 en la interfaz
 * ───────────────────────────────────────────────────────────────────────── */
describe('el precinto · la pantalla no deja declararlo intacto', () => {
  it('no hay ningún control para elegir «intacto»', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'descargando', cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);
    await screen.findByRole('button', { name: /Registrar entrega/i });

    // Ni desplegable ni opción: que coincida lo decide el servidor comparando
    // contra `cargas_terminal.numero_sello`.
    expect(screen.queryByRole('option', { name: /intacto/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/estado del sello/i)).not.toBeInTheDocument();
  });

  it('lo que SÍ ofrece es declarar que llegó roto, que es lo que sólo ve una persona', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'descargando', cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);
    expect(await screen.findByLabelText(/precinto llegó roto/i)).toBeInTheDocument();
  });

  it('muestra el sello que la terminal puso, para poder compararlo con el físico', async () => {
    // Se busca la FRASE del formulario y no el número suelto: el sello aparece
    // además en la fila de la carga y en los nombres accesibles de sus botones
    // —«Validar la carga del sello SELLO-77»—, que es correcto y hace que un
    // `findByText('SELLO-77')` encuentre cuatro. Lo que esta prueba fija es que
    // quien va a teclear el precinto tenga delante contra qué compararlo.
    const usuario = userEvent.setup();
    conApi({ estado: 'descargando', cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);
    const aviso = await screen.findByText(/Salió de la terminal con/);
    expect(aviso).toHaveTextContent('SELLO-77');
  });

  it('al registrar manda el sello leído y NO un veredicto', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'descargando', cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.type(await screen.findByLabelText(/Volumen recibido/i), '2985');
    await usuario.type(screen.getByLabelText(/Sello leído/i), 'SELLO-77');
    await usuario.type(screen.getByLabelText(/Quién recibe/i), 'Marta');
    // Regla 8 · «Toda entrega debe incluir geolocalización». En un navegador
    // sin permiso de ubicación se escriben, y quedan igual de auditadas.
    await usuario.type(screen.getByLabelText(/Latitud/i), '8.9824');
    await usuario.type(screen.getByLabelText(/Longitud/i), '-79.5199');
    await usuario.click(screen.getByRole('button', { name: /Registrar entrega/i }));

    await waitFor(() => expect(api.crear).toHaveBeenCalled());
    const [ruta, cuerpo] = api.crear.mock.calls[0];
    expect(ruta).toBe('/entregas/viaje/1');
    expect(cuerpo).toMatchObject({ selloRecibido: 'SELLO-77', volumenRecibido: 2985 });
    expect(cuerpo).not.toHaveProperty('estadoSello');
  });

  it('marcando «llegó roto» sí manda estadoSello: roto', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'descargando', cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.type(await screen.findByLabelText(/Volumen recibido/i), '2985');
    await usuario.type(screen.getByLabelText(/Sello leído/i), 'SELLO-77');
    await usuario.type(screen.getByLabelText(/Quién recibe/i), 'Marta');
    await usuario.type(screen.getByLabelText(/Latitud/i), '8.9824');
    await usuario.type(screen.getByLabelText(/Longitud/i), '-79.5199');
    await usuario.click(screen.getByLabelText(/precinto llegó roto/i));
    await usuario.click(screen.getByRole('button', { name: /Registrar entrega/i }));

    await waitFor(() => expect(api.crear).toHaveBeenCalled());
    expect(api.crear.mock.calls[0][1]).toMatchObject({ estadoSello: 'roto' });
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * La conciliación del §17, mientras se escribe
 * ───────────────────────────────────────────────────────────────────────── */
describe('la merma se calcula contra lo CARGADO y se ve antes de enviar', () => {
  it('muestra la merma en vivo al escribir el volumen recibido', async () => {
    // 2 985 de 2 990 cargados = 0,167 %. Contra los 3 000 del PLAN habría dado
    // 0,5 %, que es tres veces más y no es la cuenta que el §10.5 pide.
    const usuario = userEvent.setup();
    conApi({ estado: 'descargando', cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.type(await screen.findByLabelText(/Volumen recibido/i), '2985');
    // `es-PA` usa PUNTO decimal —Panamá sigue la convención anglosajona—, y
    // toda la aplicación formatea con ese locale. Escribir aquí una coma
    // habría hecho fallar una implementación correcta.
    expect(await screen.findByText(/0\.167\s*%/)).toBeInTheDocument();
  });

  it('avisa cuando la merma se sale de la tolerancia, antes de mandar nada', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'descargando', cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.type(await screen.findByLabelText(/Volumen recibido/i), '2800');
    expect(await screen.findByText(/necesitará aprobación/i)).toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Las separaciones de responsabilidad, visibles
 * ───────────────────────────────────────────────────────────────────────── */
describe('quien registra no es quien da por bueno', () => {
  it('validar una carga es un botón aparte del de registrarla', async () => {
    const usuario = userEvent.setup();
    conApi({ cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.click(await screen.findByRole('button', { name: /^Validar/i }));
    await waitFor(() => expect(api.crear).toHaveBeenCalledWith('/cargas/g1/validar', {}));
  });

  it('una carga ya validada no ofrece volver a validarla', async () => {
    const usuario = userEvent.setup();
    conApi({ cargas: [{ ...CARGA, estadoValidacion: 'validada' }] });
    render(<Despacho />);
    await abrirViaje(usuario);
    await screen.findByText('SELLO-77');
    expect(screen.queryByRole('button', { name: /^Validar/i })).not.toBeInTheDocument();
  });

  it('resolver un gasto exige un motivo escrito', async () => {
    // §21: hay que poder reconstruir POR QUÉ se aceptó. El botón no manda nada
    // hasta que hay motivo, en vez de dejar que el 400 lo explique.
    const usuario = userEvent.setup();
    conApi({ estado: 'descargando', cargas: [CARGA], gastos: [GASTO] });
    render(<Despacho />);
    await abrirViaje(usuario);

    const aprobar = await screen.findByRole('button', { name: /Aprobar gasto/i });
    expect(aprobar).toBeDisabled();

    await usuario.type(screen.getByLabelText(/Motivo/i), 'Comprobantes verificados');
    expect(aprobar).toBeEnabled();
    await usuario.click(aprobar);
    await waitFor(() => expect(api.actualizar).toHaveBeenCalledWith(
      '/gastos/x1', { estado: 'aprobado', motivo: 'Comprobantes verificados' }));
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * §15.5 · El panel de liquidación
 * ───────────────────────────────────────────────────────────────────────── */
describe('§15.5 · liquidación del viaje', () => {
  it('muestra los bloques que el PRD pide', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'cerrado', cargas: [CARGA], entregas: [ENTREGA], liquidacion: LIQUIDACION });
    render(<Despacho />);
    await abrirViaje(usuario);

    const panel = await screen.findByRole('region', { name: /Liquidación/i });
    for (const bloque of ['Kilómetros', 'Volúmenes', 'Mermas', 'Pago al conductor',
                          'Aprobaciones']) {
      expect(within(panel).getByText(new RegExp(bloque, 'i'))).toBeInTheDocument();
    }
  });

  it('calcular, aprobar y pagar son tres actos: sólo se ofrece el que toca', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'cerrado', cargas: [CARGA], entregas: [ENTREGA], liquidacion: LIQUIDACION });
    render(<Despacho />);
    await abrirViaje(usuario);

    // Pendiente: se aprueba. Ni se recalcula ni se paga.
    expect(await screen.findByRole('button', { name: /Aprobar liquidación/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Calcular liquidación/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar el pago/i })).not.toBeInTheDocument();
  });

  it('una vez aprobada se ofrece pagar, y el pago pide su referencia', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'cerrado', cargas: [CARGA], entregas: [ENTREGA],
             liquidacion: { ...LIQUIDACION, estado: 'aprobada' } });
    render(<Despacho />);
    await abrirViaje(usuario);

    const pagar = await screen.findByRole('button', { name: /Registrar el pago/i });
    expect(pagar).toBeDisabled();
    await usuario.type(screen.getByLabelText(/Referencia/i), 'TRF-9001');
    await usuario.click(pagar);
    await waitFor(() => expect(api.crear).toHaveBeenCalledWith(
      '/liquidaciones/l1/pagar', { referenciaPago: 'TRF-9001' }));
  });

  it('una liquidación pagada ya no ofrece ninguna acción', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'cerrado', cargas: [CARGA], entregas: [ENTREGA],
             liquidacion: { ...LIQUIDACION, estado: 'pagada', referenciaPago: 'TRF-9001' } });
    render(<Despacho />);
    await abrirViaje(usuario);

    await screen.findByRole('region', { name: /Liquidación/i });
    expect(screen.queryByRole('button', { name: /Aprobar liquidación/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar el pago/i })).not.toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Los errores que la persona tiene que poder leer
 * ───────────────────────────────────────────────────────────────────────── */
describe('los errores del servidor se cuentan, no se tragan', () => {
  it('un 403 al validar una carga aparece en pantalla', async () => {
    // Es el caso normal, no el raro: `cargas:validar` lo tiene el Supervisor y
    // no el Operador de carga. Quien registra va a toparse con esto, y el
    // mensaje es lo que le dice que no es un fallo suyo.
    const usuario = userEvent.setup();
    conApi({ cargas: [CARGA] });
    api.crear.mockRejectedValue(new ErrorApi(403, 'No tienes el permiso cargas:validar'));
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.click(await screen.findByRole('button', { name: /^Validar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cargas:validar/);
  });

  it('un fallo al cargar la lista deja la pantalla hablando, no en blanco', async () => {
    api.listar.mockRejectedValue(new ErrorApi(403, 'No tienes el permiso viajes:leer'));
    render(<Despacho />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/viajes:leer/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Lo que la lista tiene que dejar claro de un vistazo
 * ───────────────────────────────────────────────────────────────────────── */
describe('la lista de viajes', () => {
  it('sin viajes lo dice, en vez de quedarse vacía', async () => {
    api.listar.mockResolvedValue([]);
    render(<Despacho />);
    expect(await screen.findByText(/No hay viajes en despacho/i)).toBeInTheDocument();
  });

  it('sin viaje elegido explica qué hay que hacer', async () => {
    render(<Despacho />);
    expect(await screen.findByText(/Selecciona un viaje/i)).toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Los caminos completos: registrar de verdad cada cosa
 *
 * Los de arriba fijan las DECISIONES —qué se ofrece, qué no y por qué—. Éstos
 * recorren el alta entera de cada momento del viaje, que es donde vive la
 * traducción de los campos de la pantalla a los del §7 y donde un renombre
 * silencioso no se notaría hasta producción.
 * ───────────────────────────────────────────────────────────────────────── */
describe('registrar la carga en terminal', () => {
  it('manda el compartimento y la línea del PLAN, no lo que se teclee', async () => {
    // `compartimentoId` y `detalleOrdenId` salen de la línea elegida del plan.
    // Si la pantalla los pidiera a mano, ofrecería equivocarse en la relación
    // que la regla 17 existe para fijar.
    const usuario = userEvent.setup();
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.selectOptions(
      await screen.findByLabelText(/Compartimento del plan/i), 'c1:d1');
    await usuario.type(screen.getByLabelText(/Volumen cargado/i), '2990');
    await usuario.type(screen.getByLabelText(/Número de sello/i), 'SELLO-77');
    await usuario.type(screen.getByLabelText(/Operador de la terminal/i), 'Luis');
    await usuario.type(screen.getByLabelText(/Latitud/i), '9.3547');
    await usuario.type(screen.getByLabelText(/Longitud/i), '-79.9003');
    await usuario.click(screen.getByRole('button', { name: /Registrar carga/i }));

    await waitFor(() => expect(api.crear).toHaveBeenCalledWith('/cargas/viaje/1', {
      compartimentoId: 'c1', detalleOrdenId: 'd1', volumenCargado: 2990,
      numeroSello: 'SELLO-77', operadorTerminal: 'Luis',
      latitud: 9.3547, longitud: -79.9003,
    }));
  });

  it('los medidores, temperatura y densidad viajan sólo si se escriben', async () => {
    const usuario = userEvent.setup();
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.selectOptions(
      await screen.findByLabelText(/Compartimento del plan/i), 'c1:d1');
    await usuario.type(screen.getByLabelText(/Volumen cargado/i), '2990');
    await usuario.type(screen.getByLabelText(/Número de sello/i), 'S-1');
    await usuario.type(screen.getByLabelText(/Operador de la terminal/i), 'Luis');
    await usuario.type(screen.getByLabelText(/Medidor inicial/i), '1000');
    await usuario.type(screen.getByLabelText(/Medidor final/i), '3990');
    await usuario.type(screen.getByLabelText(/Temperatura/i), '29.5');
    await usuario.type(screen.getByLabelText(/Densidad/i), '0.832');
    await usuario.type(screen.getByLabelText(/Latitud/i), '9.3');
    await usuario.type(screen.getByLabelText(/Longitud/i), '-79.9');
    await usuario.click(screen.getByRole('button', { name: /Registrar carga/i }));

    await waitFor(() => expect(api.crear).toHaveBeenCalled());
    expect(api.crear.mock.calls[0][1]).toMatchObject({
      medidorInicial: 1000, medidorFinal: 3990, temperatura: 29.5, densidad: 0.832,
    });
  });

  it('pasarse de la capacidad calibrada se dice antes de mandar nada', async () => {
    // Regla 4. El servidor lo rechaza igual, pero descubrirlo después de
    // rellenar diez campos es la forma de que alguien deje de rellenarlos.
    const usuario = userEvent.setup();
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.selectOptions(
      await screen.findByLabelText(/Compartimento del plan/i), 'c1:d1');
    await usuario.type(screen.getByLabelText(/Volumen cargado/i), '4981');
    expect(await screen.findByText(/No caben más de/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Registrar carga/i })).toBeDisabled();
  });

  it('con todo el plan ya cargado, lo dice en vez de ofrecer un formulario vacío', async () => {
    const usuario = userEvent.setup();
    conApi({ cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);
    expect(await screen.findByText(/ya está cargado/i)).toBeInTheDocument();
  });
});

describe('las acciones que piden un motivo por ventana', () => {
  afterEach(() => { (window.prompt as unknown as jest.Mock)?.mockRestore?.(); });

  it('rechazar una carga manda el motivo tecleado', async () => {
    const usuario = userEvent.setup();
    jest.spyOn(window, 'prompt').mockReturnValue('El sello del acta no coincide');
    conApi({ cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.click(await screen.findByRole('button', { name: /^Rechazar la carga/i }));
    await waitFor(() => expect(api.crear).toHaveBeenCalledWith(
      '/cargas/g1/rechazar', { motivo: 'El sello del acta no coincide' }));
  });

  it('cancelar la ventana no manda nada', async () => {
    // `prompt` devuelve null al cancelar. Sin la guarda se mandaría un motivo
    // nulo y el servidor contestaría un 400 que nadie pidió.
    const usuario = userEvent.setup();
    jest.spyOn(window, 'prompt').mockReturnValue(null);
    conApi({ cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.click(await screen.findByRole('button', { name: /^Rechazar la carga/i }));
    await waitFor(() => expect(api.crear).not.toHaveBeenCalled());
  });

  it('aprobar una entrega pendiente manda su motivo', async () => {
    const usuario = userEvent.setup();
    jest.spyOn(window, 'prompt').mockReturnValue('Merma verificada con el medidor');
    conApi({ estado: 'descargando', cargas: [CARGA],
             entregas: [{ ...ENTREGA, estado: 'pendiente' }] });
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.click(await screen.findByRole('button', { name: /Aprobar entrega/i }));
    await waitFor(() => expect(api.crear).toHaveBeenCalledWith(
      '/entregas/e1/aprobar', { motivo: 'Merma verificada con el medidor' }));
  });

  it('rechazar una entrega pendiente también', async () => {
    const usuario = userEvent.setup();
    jest.spyOn(window, 'prompt').mockReturnValue('La estación no acepta la carga');
    conApi({ estado: 'descargando', cargas: [CARGA],
             entregas: [{ ...ENTREGA, estado: 'pendiente' }] });
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.click(await screen.findByRole('button', { name: /Rechazar entrega/i }));
    await waitFor(() => expect(api.crear).toHaveBeenCalledWith(
      '/entregas/e1/rechazar', { motivo: 'La estación no acepta la carga' }));
  });
});

describe('registrar un gasto', () => {
  it('manda categoría, monto y el reembolso cuando pagó el conductor', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'descargando', cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.selectOptions(await screen.findByLabelText(/^Categoría/i), 'peaje');
    await usuario.type(screen.getByLabelText(/Descripción del gasto/i), 'Peajes');
    await usuario.type(screen.getByLabelText(/^Monto/i), '18.75');
    await usuario.click(screen.getByRole('button', { name: /Registrar gasto/i }));

    await waitFor(() => expect(api.crear).toHaveBeenCalledWith('/gastos/viaje/1', {
      categoria: 'peaje', descripcion: 'Peajes', monto: 18.75,
      pagadoPor: 'conductor', reembolsable: true,
    }));
  });

  it('si pagó la empresa desaparece el reembolso: no significaría nada', async () => {
    // La base lo vigila con una CHECK que mira las dos columnas. Aquí el campo
    // ni se enseña, que es más claro que enseñarlo deshabilitado.
    const usuario = userEvent.setup();
    conApi({ estado: 'descargando', cargas: [CARGA] });
    render(<Despacho />);
    await abrirViaje(usuario);

    await screen.findByLabelText(/Quién pagó/i);
    expect(screen.getByLabelText(/reembolsa al conductor/i)).toBeInTheDocument();
    await usuario.selectOptions(screen.getByLabelText(/Quién pagó/i), 'empresa');
    expect(screen.queryByLabelText(/reembolsa al conductor/i)).not.toBeInTheDocument();
  });

  it('rechazar un gasto usa el mismo motivo que aprobarlo', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'descargando', cargas: [CARGA], gastos: [GASTO] });
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.type(await screen.findByLabelText(/Motivo/i), 'Sin comprobante');
    await usuario.click(screen.getByRole('button', { name: /Rechazar gasto/i }));
    await waitFor(() => expect(api.actualizar).toHaveBeenCalledWith(
      '/gastos/x1', { estado: 'rechazado', motivo: 'Sin comprobante' }));
  });

  it('con el viaje cerrado ya no se registran gastos', async () => {
    // Si entraran después del cierre, una liquidación ya pagada dejaría de
    // cuadrar con lo que el viaje costó.
    const usuario = userEvent.setup();
    conApi({ estado: 'cerrado', cargas: [CARGA], entregas: [ENTREGA] });
    render(<Despacho />);
    await abrirViaje(usuario);
    await screen.findByRole('region', { name: /Liquidación/i });
    expect(screen.queryByRole('button', { name: /Registrar gasto/i })).not.toBeInTheDocument();
  });
});

describe('calcular la liquidación', () => {
  it('con el viaje cerrado y sin liquidar, calcular la crea', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'cerrado', cargas: [CARGA], entregas: [ENTREGA] });
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.click(await screen.findByRole('button', { name: /Calcular liquidación/i }));
    await waitFor(() => expect(api.crear).toHaveBeenCalledWith('/liquidaciones/viaje/1', {}));
  });

  it('aprobar la liquidación pendiente usa su endpoint propio', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'cerrado', cargas: [CARGA], entregas: [ENTREGA], liquidacion: LIQUIDACION });
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.click(await screen.findByRole('button', { name: /Aprobar liquidación/i }));
    await waitFor(() => expect(api.crear).toHaveBeenCalledWith('/liquidaciones/l1/aprobar', {}));
  });

  it('el bloque de mermas señala las entregas que siguen sin resolverse', async () => {
    const usuario = userEvent.setup();
    conApi({ estado: 'cerrado', cargas: [CARGA],
             entregas: [{ ...ENTREGA, estado: 'pendiente' }], liquidacion: LIQUIDACION });
    render(<Despacho />);
    await abrirViaje(usuario);

    const panel = await screen.findByRole('region', { name: /Liquidación/i });
    expect(within(panel).getByText(/1 sin resolver todavía/i)).toBeInTheDocument();
  });
});

describe('cuando una parte del viaje no se puede leer', () => {
  it('un 403 en gastos no deja sin entregas a quien sí puede verlas', async () => {
    // Cada bloque se pide por separado y con `allSettled`: el Responsable de
    // estación no tiene `gastos:leer`, y con un `Promise.all` ese 403 le
    // dejaría la pantalla entera vacía.
    const usuario = userEvent.setup();
    conApi({ estado: 'descargando', cargas: [CARGA], entregas: [ENTREGA] });
    const listarBueno = api.listar.getMockImplementation()!;
    api.listar.mockImplementation((r: string) =>
      r.startsWith('/gastos/') ? Promise.reject(new ErrorApi(403, 'sin permiso')) : listarBueno(r));

    render(<Despacho />);
    await abrirViaje(usuario);
    expect(await screen.findByText('Entregas en estación')).toBeInTheDocument();
    expect(screen.getByText(/Sin gastos registrados/i)).toBeInTheDocument();
  });

  it('si el viaje mismo no se puede abrir, lo dice y no se queda a medias', async () => {
    const usuario = userEvent.setup();
    api.obtener.mockRejectedValue(new ErrorApi(404, 'Viaje no encontrado'));
    render(<Despacho />);
    await screen.findByText('V-001');
    await usuario.click(screen.getByText('V-001'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Viaje no encontrado/);
  });
});

describe('mover el viaje sin salir de la pantalla', () => {
  it('ofrece las transiciones que la API declara posibles', async () => {
    // La lista NO se calcula aquí: viene en `transicionesPosibles`. Si la
    // pantalla la dedujera del estado tendría una segunda copia de la máquina
    // del §8.2, y las dos se separarían en cuanto una cambiara.
    const usuario = userEvent.setup();
    api.obtener.mockImplementation((r: string) =>
      r === '/viajes/1'
        ? Promise.resolve(viaje({ transicionesPosibles: ['cargado', 'cancelado'] }))
        : Promise.reject(new ErrorApi(404, 'no hay')));
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.click(await screen.findByRole('button', { name: 'cargado' }));
    await waitFor(() => expect(api.actualizar).toHaveBeenCalledWith(
      '/viajes/1/estado', { estado: 'cargado' }));
  });

  it('cancelar exige motivo y no manda nada si se cierra la ventana', async () => {
    const usuario = userEvent.setup();
    jest.spyOn(window, 'prompt').mockReturnValue(null);
    api.obtener.mockImplementation((r: string) =>
      r === '/viajes/1'
        ? Promise.resolve(viaje({ transicionesPosibles: ['cancelado'] }))
        : Promise.reject(new ErrorApi(404, 'no hay')));
    render(<Despacho />);
    await abrirViaje(usuario);

    await usuario.click(await screen.findByRole('button', { name: 'cancelado' }));
    await waitFor(() => expect(api.actualizar).not.toHaveBeenCalled());
    (window.prompt as unknown as jest.Mock).mockRestore();
  });
});

describe('§7.15 · la bitácora del viaje', () => {
  /*
   * `eventos_viaje` y sus cinco rutas existían desde la Fase 2A y ninguna
   * pantalla las llamaba: la traza del viaje —lo único que el §7.15 existe para
   * poder demostrar— no se veía por ningún sitio. Encontrado con el `grep` de
   * la API viva contra `frontend/src` el 2026-09-12.
   *
   * Va aquí y no en una pantalla propia por la misma razón que las otras
   * cuatro secciones: un evento es SIEMPRE de un viaje.
   */
  const EVENTOS = [
    { id: 'e1', tipoEvento: 'salida', fechaHora: '2032-04-01T06:00:00Z',
      origenDato: 'web', observacion: 'Salida de planta', anulaEventoId: null },
  ];

  it('al abrir un viaje pide su traza y su verificación', async () => {
    const usuario = userEvent.setup();
    render(<Despacho />);
    await usuario.click(await screen.findByRole('button', { name: /V-001/ }));

    await waitFor(() => expect(api.listar).toHaveBeenCalledWith('/eventos/viaje/1'));
    expect(api.obtener).toHaveBeenCalledWith('/eventos/viaje/1/integridad');
  });

  it('y la enseña con el resultado de la verificación', async () => {
    const usuario = userEvent.setup();
    api.listar.mockImplementation((r: string) => {
      if (r === '/viajes') return Promise.resolve(VIAJES);
      if (r === '/eventos/viaje/1') return Promise.resolve(EVENTOS);
      return Promise.resolve([]);
    });
    const obtenerOriginal = api.obtener.getMockImplementation()!;
    api.obtener.mockImplementation((r: string) =>
      r === '/eventos/viaje/1/integridad'
        ? Promise.resolve({ integra: true, eventos: 1, rotoEn: null })
        : obtenerOriginal(r));

    render(<Despacho />);
    await usuario.click(await screen.findByRole('button', { name: /V-001/ }));

    expect(await screen.findByText('Salida de planta')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /integridad/i })).toHaveTextContent(/íntegra/i);
  });

  it('sin permiso sobre la traza, el resto de la pantalla sigue entero', async () => {
    /* `eventos:leer` es un permiso propio: hay repartos que lo niegan y sí dejan
       ver entregas y gastos. Con un `Promise.all` un 403 aquí dejaría la
       pantalla entera sin nada, que es peor que sin bitácora. */
    const usuario = userEvent.setup();
    api.listar.mockImplementation((r: string) => {
      if (r === '/viajes') return Promise.resolve(VIAJES);
      if (r === '/eventos/viaje/1') return Promise.reject(new ErrorApi(403, 'Sin permiso'));
      return Promise.resolve([]);
    });
    const obtenerOriginal = api.obtener.getMockImplementation()!;
    api.obtener.mockImplementation((r: string) =>
      r === '/eventos/viaje/1/integridad'
        ? Promise.reject(new ErrorApi(403, 'Sin permiso'))
        : obtenerOriginal(r));

    render(<Despacho />);
    await usuario.click(await screen.findByRole('button', { name: /V-001/ }));

    // La sección está, dice lo que no pudo comprobar, y las demás funcionan.
    expect(await screen.findByText(/no se pudo comprobar/i)).toBeInTheDocument();
    expect(screen.getByText(/Gastos del viaje/)).toBeInTheDocument();
  });
});
