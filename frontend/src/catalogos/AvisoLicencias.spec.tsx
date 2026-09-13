import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AvisoLicencias } from './AvisoLicencias';
import { ErrorApi } from '@/api/cliente';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { listar: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as { api: { listar: jest.Mock } };

/*
 * §6.6 · Vencimientos de licencia.
 *
 * `GET /conductores/licencias-por-vencer` es el endpoint que estuvo roto de una
 * forma peculiar: existía, tenía su permiso, estaba declarado antes de `:id` y
 * respondía 400 siempre que no se le pasara `?dias=` —o sea, en su uso normal—
 * porque `ParseIntPipe({optional:true})` recibía el valor antes de poder
 * descartarlo por nulo. Ninguna prueba de servicio podía verlo: el servicio
 * funcionaba mientras nadie podía llegar a él.
 *
 * Se arregló el 2026-09-12 y siguió SIN PANTALLA que lo llamara, que es la
 * segunda mitad del mismo problema.
 *
 * LO QUE ESTA PANTALLA AÑADE SOBRE LA API
 *
 * La consulta es `fecha <= hoy + N días`, así que en la misma lista vienen las
 * que van a vencer y **las que ya vencieron**. No son lo mismo: una licencia
 * vencida no es un aviso, es un conductor que hoy no puede conducir. Separarlas
 * es todo el valor que aporta esta sección.
 */

const dias = (n: number) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const CONDUCTORES = [
  { id: 'c1', nombreCompleto: 'Ana Pérez',  licencia: 'L-1',
    fechaVencimientoLicencia: dias(-3), estado: 'activo' },
  { id: 'c2', nombreCompleto: 'Luis Gómez', licencia: 'L-2',
    fechaVencimientoLicencia: dias(12), estado: 'activo' },
];

beforeEach(() => { jest.clearAllMocks(); api.listar.mockResolvedValue(CONDUCTORES); });

const filaDe = (t: string) => screen.getByRole('row', { name: new RegExp(t) });

describe('lo que pide', () => {
  it('pide 30 días por omisión, y con el parámetro puesto', async () => {
    /* Explícito aunque el backend ya lo ponga por omisión: el día que alguien
       cambie el valor del servidor, esta pantalla seguirá enseñando el
       horizonte que dice enseñar. */
    render(<AvisoLicencias />);
    await waitFor(() => expect(api.listar)
      .toHaveBeenCalledWith('/conductores/licencias-por-vencer?dias=30'));
  });

  it('el horizonte se puede cambiar', async () => {
    const usuario = userEvent.setup();
    render(<AvisoLicencias />);
    await screen.findByText('Ana Pérez');
    await usuario.click(screen.getByRole('button', { name: /90 días/ }));
    await waitFor(() => expect(api.listar)
      .toHaveBeenCalledWith('/conductores/licencias-por-vencer?dias=90'));
  });
});

describe('vencida y por vencer no son lo mismo', () => {
  it('a quien ya se le venció, lo dice con esa palabra', async () => {
    render(<AvisoLicencias />);
    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
    expect(filaDe('Ana Pérez')).toHaveTextContent(/vencida/i);
  });

  it('y a quien le queda tiempo, le pone los días que faltan', async () => {
    render(<AvisoLicencias />);
    await screen.findByText('Luis Gómez');
    expect(filaDe('Luis Gómez')).toHaveTextContent(/12 días/);
    expect(filaDe('Luis Gómez')).not.toHaveTextContent(/vencida/i);
  });

  it('el recuento separa las dos cifras, que es lo que se mira de un vistazo', async () => {
    // «2 licencias por vencer» mete en el mismo saco a quien no puede conducir
    // hoy con quien tiene doce días para renovar.
    render(<AvisoLicencias />);
    /* Se espera a un DATO, no al `role=status`: la región existe desde el
       primer render con el texto «Consultando vencimientos…», así que
       `findByRole` la encuentra al instante y la afirmación corre antes de que
       lleguen los datos. Un `findBy*` sobre algo que ya está en el DOM no
       espera nada. */
    await screen.findByText('Ana Pérez');
    const resumen = screen.getByRole('status', { name: /licencias/i });
    expect(resumen).toHaveTextContent(/1 vencida/i);
    expect(resumen).toHaveTextContent(/1 por vencer/i);
  });

  it('las vencidas van primero, aunque la API ordene por fecha', async () => {
    // La API ordena por fecha ascendente, que casualmente las pone primero. Se
    // ordena aquí también para que siga siendo cierto si eso cambia.
    api.listar.mockResolvedValue([CONDUCTORES[1], CONDUCTORES[0]]);
    render(<AvisoLicencias />);
    await screen.findByText('Ana Pérez');
    const filas = screen.getAllByRole('row').slice(1);
    expect(filas[0]).toHaveTextContent('Ana Pérez');
  });
});

describe('cuando no hay nada que avisar', () => {
  it('lo dice en vez de desaparecer', async () => {
    /* Mismo criterio que el indicador de integridad de la bitácora: una sección
       que sólo aparece cuando algo va mal es indistinguible de una averiada.
       «Ninguna vence en 30 días» es información, y de la buena. */
    api.listar.mockResolvedValue([]);
    render(<AvisoLicencias />);
    expect(await screen.findByText(/Ninguna licencia vence/i)).toBeInTheDocument();
  });
});

describe('cuando falla', () => {
  it('lo dice y NO afirma que todo esté en regla', async () => {
    api.listar.mockRejectedValue(new ErrorApi(403, 'No tienes permiso'));
    render(<AvisoLicencias />);
    expect(await screen.findByText(/No tienes permiso/)).toBeInTheDocument();
    expect(screen.queryByText(/Ninguna licencia vence/i)).not.toBeInTheDocument();
  });
});

describe('llegar al conductor', () => {
  it('cada fila enseña su licencia, para poder buscarlo en la tabla de abajo', async () => {
    render(<AvisoLicencias />);
    await screen.findByText('Ana Pérez');
    expect(within(filaDe('Ana Pérez')).getByText('L-1')).toBeInTheDocument();
  });
});

describe('los bordes del cálculo', () => {
  it('la que vence HOY no dice «faltan 0 días»', async () => {
    /* «Faltan 0 días» se lee como un redondeo y como que hay margen. Hoy es el
       último día en que ese conductor puede conducir legalmente, y mañana su
       licencia estará vencida. */
    api.listar.mockResolvedValue([{ id: 'c3', nombreCompleto: 'Hoy Mismo',
      licencia: 'L-3', fechaVencimientoLicencia: dias(0), estado: 'activo' }]);
    render(<AvisoLicencias />);
    await screen.findByText('Hoy Mismo');
    expect(filaDe('Hoy Mismo')).toHaveTextContent(/vence hoy/i);
    expect(filaDe('Hoy Mismo')).not.toHaveTextContent(/0 días/);
  });

  it('y cuenta como «por vencer», no como vencida', async () => {
    api.listar.mockResolvedValue([{ id: 'c3', nombreCompleto: 'Hoy Mismo',
      licencia: 'L-3', fechaVencimientoLicencia: dias(0), estado: 'activo' }]);
    render(<AvisoLicencias />);
    await screen.findByText('Hoy Mismo');
    expect(screen.getByRole('status', { name: /licencias/i })).toHaveTextContent(/0 vencida/i);
  });

  it('un fallo sin API tampoco se traga', async () => {
    api.listar.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<AvisoLicencias />);
    expect(await screen.findByText(/No se pudieron consultar los vencimientos/))
      .toBeInTheDocument();
  });
});
