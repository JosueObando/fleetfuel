import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterChip } from './FilterChip';

/*
 * Ficha 7 · Filtro MÚLTIPLE. La diferencia con el segmentado no es estética:
 * aquí cada chip es un interruptor independiente que puede estar encendido a la
 * vez que los demás, y eso se dice con `aria-pressed`, no con `aria-current`
 * ni con radios.
 */

const SOCIOS = [
  { id: 'aseo', etiqueta: 'Aseo Urbano', conteo: 4, activo: true },
  { id: 'obras', etiqueta: 'Obras', conteo: 2 },
  { id: 'parques', etiqueta: 'Parques', conteo: 0, deshabilitado: true },
];

describe('es múltiple, y lo dice', () => {
  it('cada chip es un interruptor con su estado', () => {
    render(<FilterChip socios={SOCIOS} />);
    expect(screen.getByRole('button', { name: /Aseo Urbano/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Obras/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('pueden estar varios encendidos a la vez', () => {
    render(<FilterChip socios={SOCIOS.map(s => ({ ...s, activo: true }))} />);
    const encendidos = screen.getAllByRole('button')
      .filter(b => b.getAttribute('aria-pressed') === 'true');
    expect(encendidos).toHaveLength(3);
  });

  it('los chips se anuncian como parte de UN filtro, no sueltos', () => {
    // Sin el grupo etiquetado, un lector de pantalla lee tres botones con
    // nombres de departamento y ninguna pista de para qué sirven.
    render(<FilterChip socios={SOCIOS} />);
    expect(screen.getByRole('group', { name: 'Filtrar por socios' })).toBeInTheDocument();
  });

  it('el rótulo del grupo se puede cambiar', () => {
    render(<FilterChip socios={SOCIOS} overline="Filtrar por zona" />);
    expect(screen.getByRole('group', { name: 'Filtrar por zona' })).toBeInTheDocument();
  });
});

describe('interacción', () => {
  it('alternar avisa con el id', async () => {
    const usuario = userEvent.setup();
    const onAlternar = jest.fn();
    render(<FilterChip socios={SOCIOS} onAlternar={onAlternar} />);
    await usuario.click(screen.getByRole('button', { name: /Obras/ }));
    expect(onAlternar).toHaveBeenCalledWith('obras');
  });

  it('un chip deshabilitado no alterna', async () => {
    const usuario = userEvent.setup();
    const onAlternar = jest.fn();
    render(<FilterChip socios={SOCIOS} onAlternar={onAlternar} />);
    await usuario.click(screen.getByRole('button', { name: /Parques/ }));
    expect(onAlternar).not.toHaveBeenCalled();
  });

  it('un conteo de cero se muestra, no se esconde', async () => {
    // «Parques (0)» informa: no hay envíos de ese socio. Esconderlo haría creer
    // que el socio no existe.
    render(<FilterChip socios={SOCIOS} />);
    expect(screen.getByRole('button', { name: /Parques/ })).toHaveTextContent('0');
  });
});
