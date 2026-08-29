import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMITE_INSCRIPCION_MFA } from '../decorators/permite-inscripcion-mfa.decorator';
import { UsuarioAutenticado } from '../decorators/usuario-actual.decorator';

/**
 * §7: un usuario cuyo rol exige TOTP y todavía no lo configuró recibe una
 * sesión mutilada, no una sesión normal. Este guard es lo que la mutila: deja
 * pasar sólo los endpoints marcados con `@PermiteInscripcionMfa()`.
 *
 * Va después de JwtAuthGuard (necesita `request.user` ya resuelto) y antes de
 * PermisosGuard. El orden no es casual: la sesión de inscripción viaja con
 * `permisos: []`, así que PermisosGuard ya la rechazaría en cualquier ruta con
 * permiso declarado — pero devolvería «te falta el permiso X», que manda al
 * usuario a pedirle a un administrador algo que ya tiene. Cortando antes se le
 * dice lo que de verdad le pasa: le falta configurar su segundo factor.
 */
@Injectable()
export class InscripcionMfaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const usuario: UsuarioAutenticado | undefined = contexto.switchToHttp().getRequest().user;
    if (usuario?.tipoSesion !== 'inscripcion-mfa') return true;

    const permitido = this.reflector.getAllAndOverride<boolean>(PERMITE_INSCRIPCION_MFA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (permitido) return true;

    throw new ForbiddenException(
      'Sesión de inscripción MFA: tu rol exige un segundo factor que aún no configuraste. ' +
        'Completa POST /auth/mfa/iniciar y POST /auth/mfa/confirmar, y vuelve a iniciar sesión.',
    );
  }
}
