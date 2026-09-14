import { render, screen } from '@testing-library/react';
import Pagina from './page';

jest.mock('next/navigation', () => jest.requireActual('../../../../pruebas/router'));
jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { listar: jest.fn().mockResolvedValue([]) } };
});

/* El cableado de la ruta, no su comportamiento — eso está en
   `Planificador.spec.tsx`. Aquí importa el límite de Suspense: sin él,
   `useSearchParams` rompe el build estático, y eso no falla en `npm test`. */
it('la ruta /operacion/planificador monta el planificador dentro de su Suspense', async () => {
  render(<Pagina />);
  expect(await screen.findByRole('heading', { name: 'Planificador' })).toBeInTheDocument();
});
