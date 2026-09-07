import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermisosGuard } from './permisos.guard';
import { ES_PUBLICO } from '../decorators/publico.decorator';
import { PERMISOS } from '../decorators/permisos.decorator';

function contextoCon(usuario: unknown): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: usuario }) }),
  } as unknown as ExecutionContext;
}

function reflectorCon(valores: Record<string, unknown>): Reflector {
  return { getAllAndOverride: (clave: string) => valores[clave] } as unknown as Reflector;
}

describe('PermisosGuard', () => {
  it('deja pasar las rutas públicas', () => {
    const guard = new PermisosGuard(reflectorCon({ [ES_PUBLICO]: true }));
    expect(guard.canActivate(contextoCon(undefined))).toBe(true);
  });

  it('deja pasar cuando el endpoint no declara permisos', () => {
    const guard = new PermisosGuard(reflectorCon({ [PERMISOS]: undefined }));
    expect(guard.canActivate(contextoCon({ permisos: [] }))).toBe(true);
  });

  it('exige todos los permisos declarados, no cualquiera', () => {
    const guard = new PermisosGuard(reflectorCon({ [PERMISOS]: ['a:leer', 'a:escribir'] }));
    expect(() => guard.canActivate(contextoCon({ permisos: ['a:leer'] })))
      .toThrow(/Faltan: a:escribir/);
  });

  it('acepta cuando están todos', () => {
    const guard = new PermisosGuard(reflectorCon({ [PERMISOS]: ['a:leer', 'a:escribir'] }));
    expect(guard.canActivate(contextoCon({ permisos: ['a:escribir', 'a:leer', 'z:otro'] }))).toBe(true);
  });

  it('no existe rol con paso libre: el fraude de volumen del §7 vive ahí', () => {
    // Un rol llamado "Administrador General" tampoco
    // evade la comprobación. Si esta prueba empieza a fallar es que alguien
    // reintrodujo el bypass, y con él la posibilidad de que una sola persona
    // capture la carga y la entrega.
    const guard = new PermisosGuard(reflectorCon({ [PERMISOS]: ['liquidaciones:aprobar'] }));
    const admin = { roles: ['Administrador General', 'Administrador'], permisos: [] };
    expect(() => guard.canActivate(contextoCon(admin))).toThrow(ForbiddenException);
  });

  it('rechaza si no hay usuario', () => {
    const guard = new PermisosGuard(reflectorCon({ [PERMISOS]: ['a:leer'] }));
    expect(() => guard.canActivate(contextoCon(undefined))).toThrow(/no autenticado/);
  });
});
