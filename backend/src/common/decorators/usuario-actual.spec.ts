import { ExecutionContext } from '@nestjs/common';
import { resolverUsuarioActual, UsuarioAutenticado } from './usuario-actual.decorator';

const ctxCon = (user: unknown): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

const USUARIO: UsuarioAutenticado = {
  id: '7', empresaId: '1', correo: 'ana@ejemplo.test',
  roles: ['Despachador'], permisos: ['viajes:leer'], dispositivoId: null,
  tipoSesion: 'acceso',
};

describe('UsuarioActual · lo que llega al controlador', () => {
  it('sin campo devuelve el usuario entero', () => {
    expect(resolverUsuarioActual(undefined, ctxCon(USUARIO))).toEqual(USUARIO);
  });

  it('con campo devuelve sólo ese campo', () => {
    expect(resolverUsuarioActual('empresaId', ctxCon(USUARIO))).toBe('1');
  });

  it('en una ruta pública devuelve undefined en vez de reventar', () => {
    // La rama que no cubría nadie. Una ruta `@Publico()` no pasa por
    // JwtStrategy, así que `request.user` no existe: sin el `?.` esto sería un
    // TypeError, o sea un 500 en una ruta que ni siquiera exige sesión.
    expect(resolverUsuarioActual('empresaId', ctxCon(undefined))).toBeUndefined();
    expect(resolverUsuarioActual(undefined, ctxCon(undefined))).toBeUndefined();
  });
});
