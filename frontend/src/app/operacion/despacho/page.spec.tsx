import { render, screen } from '@testing-library/react';
import Pagina from './page';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: {
    listar: jest.fn().mockResolvedValue([]), obtener: jest.fn().mockResolvedValue({}),
    crear: jest.fn(), actualizar: jest.fn(), desactivar: jest.fn(),
  } };
});

/*
 * El cableado de la ruta, no su comportamiento — eso está en
 * `Despacho.spec.tsx`, una vez.
 *
 * Mismo criterio que `catalogos/paginas.spec.tsx`: suena tonto hasta que
 * alguien copia el fichero para crear la ruta siguiente y se deja el
 * componente del anterior. La pantalla carga, se ve bien, y opera sobre otra
 * cosa.
 */
it('la ruta /operacion/despacho monta la pantalla de despacho', async () => {
  render(<Pagina />);
  expect(await screen.findByRole('heading', { name: 'Despacho y cierre' }))
    .toBeInTheDocument();
});
