import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Campo } from './Campo';

/*
 * El campo de formulario. Lo usan las cinco pantallas de catálogo y la de
 * entrada, así que sus decisiones de accesibilidad se multiplican por seis.
 *
 * Las dos que se fijan aquí están razonadas en el propio componente y son de
 * las que se pierden en un rediseño sin que nadie lo note mirando la pantalla.
 */

const base = { etiqueta: 'Correo', valor: '', onCambio: () => undefined };

describe('la etiqueta y el campo van unidos', () => {
  it('se puede encontrar el campo POR su etiqueta', () => {
    // Si se rompiera, el campo seguiría viéndose igual y dejaría de existir
    // para quien navega con lector de pantalla o con voz.
    render(<Campo {...base} />);
    expect(screen.getByLabelText('Correo')).toBeInTheDocument();
  });

  it('el nombre accesible NO arrastra la ayuda', () => {
    // Envolviendo el conjunto en un <label>, la ayuda pasaría a formar parte
    // del nombre del campo y el lector la leería entera cada vez que el foco
    // entra. La ayuda es una DESCRIPCIÓN y va por aria-describedby.
    render(<Campo {...base} ayuda="Usa el correo institucional" />);
    const campo = screen.getByLabelText('Correo');
    expect(campo).toHaveAccessibleName('Correo');
    expect(campo).toHaveAccessibleDescription('Usa el correo institucional');
  });

  it('con error, la descripción es el ERROR y no la ayuda', () => {
    // Describir las dos a la vez hace que se lea la explicación general justo
    // cuando lo que hace falta es la corrección.
    render(<Campo {...base} ayuda="Usa el correo institucional" error="Correo inválido" />);
    expect(screen.getByLabelText('Correo')).toHaveAccessibleDescription('Correo inválido');
  });
});

describe('formas del campo', () => {
  it('con opciones renderiza un desplegable, no un texto', () => {
    render(<Campo {...base} etiqueta="Estación" opciones={[
      { valor: '1', etiqueta: 'Vía España' }, { valor: '2', etiqueta: 'Tocumen' }]} />);
    expect(screen.getByRole('combobox', { name: 'Estación' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Vía España' })).toBeInTheDocument();
  });

  it('marca lo obligatorio de forma que el navegador y el lector lo sepan', () => {
    render(<Campo {...base} requerido />);
    expect(screen.getByLabelText(/Correo/)).toBeRequired();
  });

  it('deshabilitado no se puede escribir', async () => {
    const usuario = userEvent.setup();
    const onCambio = jest.fn();
    render(<Campo {...base} deshabilitado onCambio={onCambio} />);
    await usuario.type(screen.getByLabelText('Correo'), 'algo');
    expect(onCambio).not.toHaveBeenCalled();
  });

  it('avisa de cada tecla al que lo controla', async () => {
    const usuario = userEvent.setup();
    const onCambio = jest.fn();
    render(<Campo {...base} onCambio={onCambio} />);
    await usuario.type(screen.getByLabelText('Correo'), 'ab');
    expect(onCambio).toHaveBeenCalledTimes(2);
    expect(onCambio).toHaveBeenLastCalledWith('b');
  });
});
