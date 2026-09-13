import { render, screen, within } from '@testing-library/react';
import { SeccionSolicitudes } from './SeccionSolicitudes';

/*
 * §2C · El historial de solicitudes de cambio de ruta DE UN VIAJE.
 *
 * Resolverlas vive en su bandeja; aquí se LEEN, junto al resto del viaje,
 * porque cuando una entrega no cuadra la primera pregunta es «¿por qué fue por
 * ahí?», y la respuesta —quién lo pidió, quién lo autorizó y con qué motivo—
 * es justo lo que el §21 pide poder reconstruir.
 *
 * Las filas se copian del `CAMPOS` de `solicitudes-ruta.service.ts`.
 */

const SOLICITUDES = [
  { id: 's9', viajeId: '1', codigoViaje: 'V-001', tipo: 'parada_extra', estado: 'pendiente',
    motivo: 'Recoger sello de repuesto', solicitadaPor: 'u2', solicitante: 'Luis Gómez',
    solicitadaEn: '2026-09-13T15:00:00Z', resueltaPor: null, resolvedor: null,
    resueltaEn: null, motivoResolucion: null },
  { id: 's4', viajeId: '1', codigoViaje: 'V-001', tipo: 'desvio', estado: 'aprobada',
    motivo: 'Calle cerrada en Vía España', solicitadaPor: 'u2', solicitante: 'Luis Gómez',
    solicitadaEn: '2026-09-13T13:00:00Z', resueltaPor: 'u3', resolvedor: 'Marta Ríos',
    resueltaEn: '2026-09-13T13:05:00Z', motivoResolucion: 'Ruta alterna por Transístmica' },
];

it('sin solicitudes lo dice, en vez de dejar un hueco', () => {
  render(<SeccionSolicitudes solicitudes={[]} />);
  expect(screen.getByText('Nadie ha pedido cambiar la ruta de este viaje.')).toBeInTheDocument();
});

it('respeta el orden del servidor: la más reciente primero', () => {
  render(<SeccionSolicitudes solicitudes={SOLICITUDES} />);
  const filas = screen.getAllByRole('listitem');
  expect(within(filas[0]).getByText(/Parada extra/)).toBeInTheDocument();
  expect(within(filas[1]).getByText(/Desvío/)).toBeInTheDocument();
});

it('una resuelta dice QUIÉN la autorizó y POR QUÉ', () => {
  render(<SeccionSolicitudes solicitudes={SOLICITUDES} />);
  const fila = screen.getAllByRole('listitem')[1];
  expect(within(fila).getByText('Aprobada')).toBeInTheDocument();
  expect(within(fila).getByText('Calle cerrada en Vía España')).toBeInTheDocument();
  expect(within(fila).getByText(/Pedida por Luis Gómez/)).toBeInTheDocument();
  expect(within(fila).getByText('Aprobada por Marta Ríos: Ruta alterna por Transístmica')).toBeInTheDocument();
});

it('una rechazada lo dice con su verbo', () => {
  render(<SeccionSolicitudes solicitudes={[{ ...SOLICITUDES[1], estado: 'rechazada', tipo: 'cancelacion' }]} />);
  const fila = screen.getByRole('listitem');
  expect(within(fila).getByText(/Cancelación/)).toBeInTheDocument();
  expect(within(fila).getByText('Rechazada por Marta Ríos: Ruta alterna por Transístmica')).toBeInTheDocument();
});

it('una pendiente dice dónde se resuelve, y aquí no ofrece resolverla', () => {
  render(<SeccionSolicitudes solicitudes={SOLICITUDES} />);
  const fila = screen.getAllByRole('listitem')[0];
  expect(within(fila).getByText('Pendiente')).toBeInTheDocument();
  expect(within(fila).getByText('Se resuelve en «Solicitudes de ruta».')).toBeInTheDocument();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});

it('es una región con nombre, como las demás partes del viaje', () => {
  render(<SeccionSolicitudes solicitudes={SOLICITUDES} />);
  expect(screen.getByRole('region', { name: 'Solicitudes de cambio de ruta' })).toBeInTheDocument();
});
