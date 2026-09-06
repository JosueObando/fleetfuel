import { render, screen } from '@testing-library/react';
import { CapacityGauge } from './CapacityGauge';

/*
 * Ficha 18 del spec. Lo que se prueba no es el aspecto sino la regla que el
 * aspecto implementa: el nivel de llenado tiene que ser legible SIN color.
 *
 * Es una prueba que gana valor con el tiempo. Un rediseño que cambie los
 * colores no la rompe; uno que borre el texto porque «el color ya lo dice»,
 * sí — y ese es exactamente el cambio que se cuela en una revisión visual,
 * porque en la pantalla se ve perfecto.
 */

describe('el valor se anuncia como texto, no sólo como color', () => {
  it('lo escribe en pantalla', () => {
    render(<CapacityGauge porcentaje={62} />);
    expect(screen.getByText('62%')).toBeInTheDocument();
  });

  it('y también para quien usa lector de pantalla', () => {
    render(<CapacityGauge porcentaje={62} />);
    const medidor = screen.getByRole('meter');
    expect(medidor).toHaveAttribute('aria-valuenow', '62');
    expect(medidor).toHaveAttribute('aria-valuetext', '62 por ciento');
  });

  it('redondea, no muestra decimales sueltos', () => {
    render(<CapacityGauge porcentaje={62.4} />);
    expect(screen.getByText('62%')).toBeInTheDocument();
  });
});

describe('los tres umbrales del spec', () => {
  it('por debajo del 40 % no avisa de nada', () => {
    render(<CapacityGauge porcentaje={25} />);
    expect(screen.queryByText(/Casi lleno|Sobrepeso/)).not.toBeInTheDocument();
  });

  it('entre 40 y 89 tampoco', () => {
    render(<CapacityGauge porcentaje={89} />);
    expect(screen.queryByText(/Casi lleno|Sobrepeso/)).not.toBeInTheDocument();
  });

  it('a partir del 90 avisa «Casi lleno»', () => {
    render(<CapacityGauge porcentaje={90} />);
    expect(screen.getByText('Casi lleno')).toBeInTheDocument();
  });
});

describe('el sobrepeso', () => {
  it('se dice con palabras, no sólo pintando de otro color', () => {
    // «Sigue cargando» y «para» no pueden distinguirse por el tono del ámbar:
    // es la diferencia entre una carga correcta y un camión con exceso de peso.
    render(<CapacityGauge porcentaje={104} />);
    expect(screen.getByText(/Sobrepeso/)).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '104 por ciento, sobrepeso');
  });

  it('la barra no se sale del carril aunque el número pase de 100', () => {
    render(<CapacityGauge porcentaje={140} />);
    const relleno = screen.getByRole('meter').firstElementChild as HTMLElement;
    expect(relleno.style.width).toBe('100%');
    expect(screen.getByText('140%')).toBeInTheDocument();   // el número sí es el real
  });

  it('un porcentaje negativo no dibuja una barra invertida', () => {
    render(<CapacityGauge porcentaje={-10} />);
    const relleno = screen.getByRole('meter').firstElementChild as HTMLElement;
    expect(relleno.style.width).toBe('0%');
  });
});
