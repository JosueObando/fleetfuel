import { render, screen } from '@testing-library/react';
import { StatusBadge, type EstadoEnvio } from './StatusBadge';

/*
 * El estado del envío tiene que leerse sin distinguir colores. El punto de
 * color es decoración —va `aria-hidden`— y el texto es la información.
 */

const ESPERADO: Record<EstadoEnvio, string> = {
  enRuta: 'En ruta',
  esperando: 'Esperando',
  retrasado: 'Retrasado',
  entregado: 'Entregado',
};

describe('cada estado se escribe en español', () => {
  it.each(Object.entries(ESPERADO))('%s → «%s»', (estado, texto) => {
    render(<StatusBadge estado={estado as EstadoEnvio} />);
    expect(screen.getByText(texto)).toBeInTheDocument();
  });

  it('no quedan estados sin etiqueta', () => {
    // Si alguien añade un estado al tipo y olvida la etiqueta, el componente
    // pinta `undefined` en la pantalla sin que nada falle. Esta prueba lo caza.
    for (const estado of Object.keys(ESPERADO) as EstadoEnvio[]) {
      const { container, unmount } = render(<StatusBadge estado={estado} />);
      expect(container.textContent).not.toMatch(/undefined/);
      unmount();
    }
  });
});

describe('el color es decoración, no información', () => {
  it('el punto se le oculta al lector de pantalla', () => {
    const { container } = render(<StatusBadge estado="retrasado" />);
    expect(container.querySelector('[aria-hidden]')).toBeInTheDocument();
  });

  it('el texto SIEMPRE está, en los cuatro estados', () => {
    for (const [estado, texto] of Object.entries(ESPERADO)) {
      const { container, unmount } = render(<StatusBadge estado={estado as EstadoEnvio} />);
      expect(container.textContent).toContain(texto);
      unmount();
    }
  });
});
