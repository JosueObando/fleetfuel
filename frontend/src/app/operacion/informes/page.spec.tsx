import { render, screen } from '@testing-library/react';
import Pagina from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/operacion/informes',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: {
    listar: jest.fn().mockResolvedValue([]), obtener: jest.fn().mockResolvedValue({}),
    crear: jest.fn(),
  } };
});

/* El cableado de la ruta, no su comportamiento — eso está en `Informes.spec.tsx`.
   Aquí importa además el límite de Suspense: sin él, `useSearchParams` rompe el
   build estático, y eso no falla en `npm test` sino en `npm run build`. */
it('la ruta /operacion/informes monta la pantalla dentro de su Suspense', async () => {
  render(<Pagina />);
  expect(await screen.findByRole('heading', { name: 'Informes' })).toBeInTheDocument();
});
