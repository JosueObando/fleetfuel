import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl } from './SegmentedControl';

/*
 * Ficha 8 · Segmentado EXCLUSIVO: siempre hay una opción activa.
 *
 * Se modela con radios y no con botones porque un radiogroup ya trae de fábrica
 * la navegación con flechas y el anuncio «1 de 3». Si alguien lo reescribiera
 * con `<button aria-pressed>`, se vería idéntico y perdería las dos cosas —y
 * además diría que se pueden marcar varias, que es justo lo contrario.
 */

const OPCIONES = [
  { id: 'activos', etiqueta: 'Activos', conteo: 12 },
  { id: 'todos', etiqueta: 'Todos', conteo: 30 },
  { id: 'cerrados', etiqueta: 'Cerrados' },
];

describe('es exclusivo, y lo dice', () => {
  it('se anuncia como grupo de radios, no como botones sueltos', () => {
    render(<SegmentedControl opciones={OPCIONES} seleccionada="activos" />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('exactamente UNA está marcada', () => {
    render(<SegmentedControl opciones={OPCIONES} seleccionada="todos" />);
    const marcadas = screen.getAllByRole('radio')
      .filter(r => r.getAttribute('aria-checked') === 'true');
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0]).toHaveAccessibleName(expect.stringContaining('Todos'));
  });

  it('NO usa aria-pressed, que significaría selección múltiple', () => {
    render(<SegmentedControl opciones={OPCIONES} seleccionada="activos" />);
    for (const r of screen.getAllByRole('radio')) {
      expect(r).not.toHaveAttribute('aria-pressed');
    }
  });
});

describe('interacción', () => {
  it('pulsar una opción la comunica', async () => {
    const usuario = userEvent.setup();
    const onSeleccionar = jest.fn();
    render(<SegmentedControl opciones={OPCIONES} seleccionada="activos" onSeleccionar={onSeleccionar} />);
    await usuario.click(screen.getByRole('radio', { name: /Cerrados/ }));
    expect(onSeleccionar).toHaveBeenCalledWith('cerrados');
  });

  it('deshabilitado no responde', async () => {
    const usuario = userEvent.setup();
    const onSeleccionar = jest.fn();
    render(<SegmentedControl opciones={OPCIONES} seleccionada="activos" deshabilitado
                            onSeleccionar={onSeleccionar} />);
    await usuario.click(screen.getByRole('radio', { name: /Todos/ }));
    expect(onSeleccionar).not.toHaveBeenCalled();
  });

  it('el conteo se enseña, y su ausencia no pinta «undefined»', () => {
    render(<SegmentedControl opciones={OPCIONES} seleccionada="activos" />);
    expect(screen.getByRole('radio', { name: /Activos/ })).toHaveTextContent('12');
    expect(screen.getByRole('radio', { name: /Cerrados/ })).not.toHaveTextContent('undefined');
  });
});
