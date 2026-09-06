import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './Tabs';

/*
 * Ficha 17. El patrón ARIA de tablist tiene una razón concreta: con cinco
 * pestañas tabulables, llegar al contenido cuesta cinco pulsaciones de Tab.
 * Con una sola parada y flechas dentro, cuesta una.
 *
 * Es exactamente la clase de comportamiento que se pierde al reescribir el
 * componente «igual pero más simple», porque no se ve en la pantalla.
 */

const PESTANAS = [
  { id: 'a', etiqueta: 'Resumen' },
  { id: 'b', etiqueta: 'Paradas' },
  { id: 'c', etiqueta: 'Fotos', deshabilitada: true },
  { id: 'd', etiqueta: 'Gastos' },
];

describe('estructura', () => {
  it('es un tablist con sus tabs', () => {
    render(<Tabs pestanas={PESTANAS} activa="a" />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('sólo la activa está seleccionada', () => {
    render(<Tabs pestanas={PESTANAS} activa="b" />);
    expect(screen.getByRole('tab', { name: 'Paradas' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'false');
  });

  it('sólo hay UNA parada de tabulación en todo el grupo', () => {
    // Es el punto entero del patrón. Si todas fueran tabulables, este `filter`
    // devolvería cuatro y llegar al contenido costaría cuatro pulsaciones.
    render(<Tabs pestanas={PESTANAS} activa="b" />);
    const tabulables = screen.getAllByRole('tab')
      .filter(t => t.getAttribute('tabindex') !== '-1');
    expect(tabulables).toHaveLength(1);
    expect(tabulables[0]).toHaveAccessibleName('Paradas');
  });
});

describe('navegación con flechas', () => {
  it('la derecha avanza', async () => {
    const usuario = userEvent.setup();
    const onCambiar = jest.fn();
    render(<Tabs pestanas={PESTANAS} activa="a" onCambiar={onCambiar} />);
    screen.getByRole('tab', { name: 'Resumen' }).focus();
    await usuario.keyboard('{ArrowRight}');
    expect(onCambiar).toHaveBeenCalledWith('b');
  });

  it('SALTA las deshabilitadas en vez de quedarse atascada', async () => {
    // Sin esto, la flecha lleva el foco a una pestaña que no responde y la
    // navegación por teclado se queda muerta ahí.
    const usuario = userEvent.setup();
    const onCambiar = jest.fn();
    render(<Tabs pestanas={PESTANAS} activa="b" onCambiar={onCambiar} />);
    screen.getByRole('tab', { name: 'Paradas' }).focus();
    await usuario.keyboard('{ArrowRight}');
    expect(onCambiar).toHaveBeenCalledWith('d');   // se salta «Fotos»
  });

  it('da la vuelta al llegar al extremo', async () => {
    const usuario = userEvent.setup();
    const onCambiar = jest.fn();
    render(<Tabs pestanas={PESTANAS} activa="d" onCambiar={onCambiar} />);
    screen.getByRole('tab', { name: 'Gastos' }).focus();
    await usuario.keyboard('{ArrowRight}');
    expect(onCambiar).toHaveBeenCalledWith('a');
  });

  it('la izquierda retrocede, y también da la vuelta', async () => {
    const usuario = userEvent.setup();
    const onCambiar = jest.fn();
    render(<Tabs pestanas={PESTANAS} activa="a" onCambiar={onCambiar} />);
    screen.getByRole('tab', { name: 'Resumen' }).focus();
    await usuario.keyboard('{ArrowLeft}');
    expect(onCambiar).toHaveBeenCalledWith('d');
  });

  it('otras teclas no hacen nada', async () => {
    const usuario = userEvent.setup();
    const onCambiar = jest.fn();
    render(<Tabs pestanas={PESTANAS} activa="a" onCambiar={onCambiar} />);
    screen.getByRole('tab', { name: 'Resumen' }).focus();
    await usuario.keyboard('{ArrowDown}');
    expect(onCambiar).not.toHaveBeenCalled();
  });
});
