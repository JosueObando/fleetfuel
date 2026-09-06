import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CargaJwt, JwtStrategy } from './jwt.strategy';

/*
 * Esta clase es la puerta: todo lo que entra al sistema autenticado pasa por
 * `validate`, y lo que devuelva es lo que los guards de permisos y el
 * interceptor de contexto darán por cierto el resto de la petición. Un token
 * al que le falte un campo no puede convertirse en un usuario con `permisos`
 * indefinido, porque quien lo lea después hará `.includes(...)` sobre eso.
 */

const estrategia = () =>
  new JwtStrategy({ get: () => 'secreto-de-prueba' } as unknown as ConfigService);

const CARGA: CargaJwt = {
  sub: 'u1', emp: 'e1', correo: 'a@b.pa',
  roles: ['Administrador'], permisos: ['viajes:crear'], disp: 'd1',
};

describe('JwtStrategy.validate', () => {
  it('traduce un token completo al usuario autenticado', async () => {
    await expect(estrategia().validate(CARGA)).resolves.toEqual({
      id: 'u1', empresaId: 'e1', correo: 'a@b.pa',
      roles: ['Administrador'], permisos: ['viajes:crear'],
      dispositivoId: 'd1', tipoSesion: 'acceso',
    });
  });

  it('rechaza un token de refresco usado como token de acceso', async () => {
    // Están firmados con secretos distintos, así que no debería llegar aquí.
    // La comprobación cubre el día que alguien los unifique «para simplificar».
    await expect(estrategia().validate({ ...CARGA, tipo: 'refresco' }))
      .rejects.toThrow(UnauthorizedException);
  });

  it('rechaza un token sin empresa', async () => {
    // Sin empresa no hay `app.empresa_id` que fijar, y la RLS del ADR 003 se
    // queda sin el valor del que depende TODO el aislamiento entre empresas.
    const { emp, ...sinEmpresa } = CARGA;
    await expect(estrategia().validate(sinEmpresa as CargaJwt))
      .rejects.toThrow('Token sin empresa');
  });

  it('deja la sesión mutilada de inscripción de MFA pasar, marcada como tal', async () => {
    // El §7 la necesita: autentica, pero sólo sirve para configurar el segundo
    // factor. Quien la corta es InscripcionMfaGuard, mirando este `tipoSesion`.
    const u = await estrategia().validate({ ...CARGA, tipo: 'inscripcion-mfa' });
    expect(u.tipoSesion).toBe('inscripcion-mfa');
  });

  it('un token sin roles ni permisos da listas vacías, nunca undefined', async () => {
    // La rama que no cubría nadie. Importa porque el guard de permisos hace
    // `permisos.includes(...)`: con undefined la petición no se DENIEGA, revienta
    // con un 500 que oculta que lo que pasaba era una falta de autorización.
    const { roles, permisos, disp, ...pelado } = CARGA;
    const u = await estrategia().validate(pelado as CargaJwt);
    expect(u.roles).toEqual([]);
    expect(u.permisos).toEqual([]);
    expect(u.dispositivoId).toBeNull();
  });
});
