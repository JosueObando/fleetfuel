import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InscripcionMfaGuard } from './inscripcion-mfa.guard';
import { PERMITE_INSCRIPCION_MFA } from '../decorators/permite-inscripcion-mfa.decorator';

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

const SESION_NORMAL = { tipoSesion: 'acceso', permisos: ['usuarios:leer'] };
const SESION_INSCRIPCION = { tipoSesion: 'inscripcion-mfa', permisos: [] };

describe('InscripcionMfaGuard (§7)', () => {
  it('no se mete con una sesión normal', () => {
    const guard = new InscripcionMfaGuard(reflectorCon({}));
    expect(guard.canActivate(contextoCon(SESION_NORMAL))).toBe(true);
  });

  it('no se mete cuando no hay usuario: eso ya lo decidió JwtAuthGuard', () => {
    const guard = new InscripcionMfaGuard(reflectorCon({}));
    expect(guard.canActivate(contextoCon(undefined))).toBe(true);
  });

  it('bloquea una sesión de inscripción en un endpoint de negocio', () => {
    const guard = new InscripcionMfaGuard(reflectorCon({ [PERMITE_INSCRIPCION_MFA]: undefined }));
    expect(() => guard.canActivate(contextoCon(SESION_INSCRIPCION)))
      .toThrow(ForbiddenException);
  });

  it('explica el motivo real, no «te falta un permiso»', () => {
    const guard = new InscripcionMfaGuard(reflectorCon({ [PERMITE_INSCRIPCION_MFA]: undefined }));
    expect(() => guard.canActivate(contextoCon(SESION_INSCRIPCION)))
      .toThrow(/segundo factor/);
  });

  it('deja pasar los endpoints marcados con @PermiteInscripcionMfa()', () => {
    const guard = new InscripcionMfaGuard(reflectorCon({ [PERMITE_INSCRIPCION_MFA]: true }));
    expect(guard.canActivate(contextoCon(SESION_INSCRIPCION))).toBe(true);
  });

  // La que de verdad importa a futuro: un endpoint nuevo, que nadie se acordó
  // de marcar, tiene que quedar CERRADO a estas sesiones. Si esta prueba se
  // pone en verde invirtiendo la lógica del guard, el §7 se cae solo.
  it('cierra por omisión: un endpoint nuevo sin marcar queda fuera', () => {
    const guard = new InscripcionMfaGuard(reflectorCon({}));
    expect(() => guard.canActivate(contextoCon(SESION_INSCRIPCION)))
      .toThrow(ForbiddenException);
  });
});
