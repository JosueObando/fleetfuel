import { huellaDeCorreo, rastreadorPorCuenta, rastreadorPorIp } from './rastreadores';

/*
 * Lo que se fija aquí es POR QUÉ CLAVE se cuenta, que es lo que decide a quién
 * frena el límite y a quién no. Los tres fallos que previene son silenciosos:
 * el freno seguiría devolviendo 429 y pareciendo que funciona.
 */

describe('huellaDeCorreo', () => {
  it('mete el mismo correo en el mismo cupo aunque cambien mayúsculas y espacios', () => {
    // Si no, alternar mayúsculas da intentos infinitos: `Admin@x`, `ADmin@x`,
    // `aDmin@x`… son cupos distintos y el freno no frena nada.
    const esperada = huellaDeCorreo('admin@mupa.gob.pa');
    expect(huellaDeCorreo('ADMIN@MUPA.GOB.PA')).toBe(esperada);
    expect(huellaDeCorreo('  Admin@Mupa.Gob.Pa  ')).toBe(esperada);
  });

  it('separa cuentas distintas', () => {
    expect(huellaDeCorreo('uno@x.pa')).not.toBe(huellaDeCorreo('dos@x.pa'));
  });

  it('no lleva el correo en claro', () => {
    // La clave acaba en Redis: un `KEYS *` no tiene por qué devolver la lista
    // de quién intentó entrar hoy.
    expect(huellaDeCorreo('admin@mupa.gob.pa')).not.toContain('admin');
    expect(huellaDeCorreo('admin@mupa.gob.pa')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('aguanta cualquier cosa en el cuerpo sin reventar', () => {
    // Los guards corren ANTES que el ValidationPipe: aquí el cuerpo es lo que
    // mandó el cliente, sin validar. Si esto lanzara, el guard fallaría y la
    // petición no se contaría — un freno que se desactiva mandando basura.
    for (const basura of [undefined, null, 42, {}, [], true, '']) {
      expect(() => huellaDeCorreo(basura)).not.toThrow();
    }
    expect(huellaDeCorreo(undefined)).toBe('sin-correo');
  });
});

describe('rastreadorPorCuenta', () => {
  it('separa a los vecinos de NAT que van a cuentas distintas', () => {
    // El caso que motiva que haya DOS frenos: si la oficina sale por una sola
    // dirección, los intentos de Ana no pueden gastar el cupo de Beto.
    const ana = rastreadorPorCuenta({ ip: '200.1.2.3', body: { correo: 'ana@x.pa' } });
    const beto = rastreadorPorCuenta({ ip: '200.1.2.3', body: { correo: 'beto@x.pa' } });
    expect(ana).not.toBe(beto);
  });

  it('separa la misma cuenta atacada desde direcciones distintas', () => {
    const desdeFuera = rastreadorPorCuenta({ ip: '9.9.9.9', body: { correo: 'ana@x.pa' } });
    const desdeDentro = rastreadorPorCuenta({ ip: '200.1.2.3', body: { correo: 'ana@x.pa' } });
    expect(desdeFuera).not.toBe(desdeDentro);
  });

  it('agrupa los intentos repetidos contra la misma cuenta desde la misma IP', () => {
    // Es el caso que hay que frenar: quien ya acertó la clave y recorre los
    // códigos TOTP va siempre a la MISMA cuenta desde la MISMA dirección.
    expect(rastreadorPorCuenta({ ip: '9.9.9.9', body: { correo: 'ana@x.pa' } }))
      .toBe(rastreadorPorCuenta({ ip: '9.9.9.9', body: { correo: 'ANA@x.pa' } }));
  });

  it('no se queda sin clave cuando no hay cuerpo ni IP', () => {
    expect(rastreadorPorCuenta({})).toBe('sin-ip|sin-correo');
  });
});

describe('rastreadorPorIp', () => {
  it('agrupa todo lo que viene de una dirección', () => {
    expect(rastreadorPorIp({ ip: '9.9.9.9', body: { correo: 'a@x.pa' } }))
      .toBe(rastreadorPorIp({ ip: '9.9.9.9', body: { correo: 'b@x.pa' } }));
  });
});
