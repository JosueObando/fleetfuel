import { huellaDe } from './idempotencia.interceptor';

describe('huella de idempotencia', () => {
  const base = { method: 'POST', url: '/api/usuarios', body: { nombre: 'Ana', correo: 'a@b.pa' } };

  it('el orden de las claves del JSON no cambia la huella', () => {
    const otroOrden = { ...base, body: { correo: 'a@b.pa', nombre: 'Ana' } };
    // Si esto fallara, dos clientes que serializan el mismo objeto en distinto
    // orden recibirían un 422 al reintentar — el fallo más confuso posible.
    expect(huellaDe(otroOrden)).toBe(huellaDe(base));
  });

  it('reordena también dentro de objetos anidados', () => {
    const a = { ...base, body: { x: { p: 1, q: 2 }, y: [{ m: 1, n: 2 }] } };
    const b = { ...base, body: { y: [{ n: 2, m: 1 }], x: { q: 2, p: 1 } } };
    expect(huellaDe(a)).toBe(huellaDe(b));
  });

  it('conserva el orden de los arreglos: [1,2] no es [2,1]', () => {
    const a = { ...base, body: { compartimentos: [1, 2] } };
    const b = { ...base, body: { compartimentos: [2, 1] } };
    expect(huellaDe(a)).not.toBe(huellaDe(b));
  });

  it('un cuerpo distinto da una huella distinta', () => {
    const otro = { ...base, body: { nombre: 'Beto', correo: 'a@b.pa' } };
    expect(huellaDe(otro)).not.toBe(huellaDe(base));
  });

  it('la misma clave en otra ruta no se considera la misma operación', () => {
    expect(huellaDe({ ...base, url: '/api/roles' })).not.toBe(huellaDe(base));
  });

  it('es un sha256 en hexadecimal', () => {
    expect(huellaDe(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
