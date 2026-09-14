import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { rellenar } from '../pruebas/rellenar';

/*
 * El helper de relleno de `pruebas/`. Vive aquí porque `testMatch` sólo mira
 * `src/`, igual que `umbral.spec.ts`.
 *
 * Lo que tiene que garantizar es que CAMBIARLO por `usuario.type` no cambia lo
 * que ve el componente al final, y que se niega donde sí lo cambiaría.
 */
function Controlado({ tipo = 'text', alCambiar }: { tipo?: string; alCambiar: (v: string) => void }) {
  const [valor, setValor] = useState('previo');
  return (
    <label>Campo
      <input type={tipo} value={valor} onChange={e => { setValor(e.target.value); alCambiar(e.target.value); }} />
    </label>
  );
}

it('en un campo controlado deja el mismo valor final que teclear', async () => {
  const usuario = userEvent.setup();
  const tecleado = jest.fn();
  const { unmount } = render(<Controlado alCambiar={tecleado} />);
  await usuario.type(screen.getByLabelText('Campo'), 'SELLO-77');
  const conTeclado = (screen.getByLabelText('Campo') as HTMLInputElement).value;
  unmount();

  const pegado = jest.fn();
  render(<Controlado alCambiar={pegado} />);
  await rellenar(usuario, screen.getByLabelText('Campo'), 'SELLO-77');
  expect((screen.getByLabelText('Campo') as HTMLInputElement).value).toBe(conTeclado);
  // Y el componente se entera: el último onChange lleva el texto entero.
  expect(pegado).toHaveBeenLastCalledWith(conTeclado);
  // Lo que NO es igual, y por eso Campo.spec sigue tecleando: un aviso, no ocho.
  expect(pegado).toHaveBeenCalledTimes(1);
  expect(tecleado).toHaveBeenCalledTimes(8);
});

it('en un campo numérico también', async () => {
  const usuario = userEvent.setup();
  const pegado = jest.fn();
  render(<Controlado tipo="number" alCambiar={pegado} />);
  const campo = screen.getByLabelText('Campo') as HTMLInputElement;
  await usuario.clear(campo);
  await rellenar(usuario, campo, '-79.5199');
  expect(campo.value).toBe('-79.5199');
});

it('se niega en un campo de fecha, en vez de dar un verde dudoso', async () => {
  const usuario = userEvent.setup();
  render(<Controlado tipo="date" alCambiar={jest.fn()} />);
  await expect(rellenar(usuario, screen.getByLabelText('Campo'), '2026-01-15'))
    .rejects.toThrow('rellenar() no sirve para un campo de tipo date: usa usuario.type');
});

it('se niega con teclas especiales: eso es teclado', async () => {
  const usuario = userEvent.setup();
  render(<Controlado alCambiar={jest.fn()} />);
  await expect(rellenar(usuario, screen.getByLabelText('Campo'), 'x{Enter}'))
    .rejects.toThrow(/teclas especiales/);
});
