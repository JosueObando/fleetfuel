import { normalizarIp } from './intentos-login.service';

/*
 * En `inet`, `::ffff:10.0.0.19` y `10.0.0.19` son familias distintas y NO
 * comparan entre sí. Si se guardaran las dos formas, buscar por la IPv4 daría
 * cero filas para las conexiones directas — y cero filas se lee como «no hubo
 * intentos», que es exactamente la conclusión contraria a la verdadera.
 */
describe('normalizarIp', () => {
  it('desenvuelve las IPv4 que Node entrega mapeadas en IPv6', () => {
    expect(normalizarIp('::ffff:10.0.0.19')).toBe('10.0.0.19');
    expect(normalizarIp('::ffff:172.18.0.1')).toBe('172.18.0.1');
  });

  it('deja intactas las IPv4 que ya vienen limpias del proxy', () => {
    expect(normalizarIp('10.0.0.193')).toBe('10.0.0.193');
  });

  it('no toca una IPv6 de verdad', () => {
    // `::1` no es una IPv4 mapeada: recortarle nada la corrompería.
    expect(normalizarIp('::1')).toBe('::1');
    expect(normalizarIp('2001:db8::7')).toBe('2001:db8::7');
  });

  it('convierte la ausencia en NULL y no en cadena vacía', () => {
    // '' no es un `inet` válido: el INSERT fallaría y el intento sería el único
    // que no quedara registrado.
    expect(normalizarIp(undefined)).toBeNull();
    expect(normalizarIp('')).toBeNull();
  });
});
