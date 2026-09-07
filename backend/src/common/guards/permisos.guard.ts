import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ES_PUBLICO } from '../decorators/publico.decorator';
import { PERMISOS } from '../decorators/permisos.decorator';
import { UsuarioAutenticado } from '../decorators/usuario-actual.decorator';

/**
 * RBAC por permiso granular (§7).
 *
 * No hay rol con paso libre, a diferencia de lo habitual. Aquí el riesgo del
 * negocio es el fraude de volumen, y un "Administrador General" que evade toda
 * comprobación es precisamente el agujero por donde se cuela: la separación
 * entre quien captura la carga y quien captura la entrega deja de existir si
 * un rol puede hacerlo todo. El administrador tiene muchos permisos, pero los
 * tiene explícitamente y quedan en la bitácora.
 */
@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const publico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (publico) return true;

    const requeridos = this.reflector.getAllAndOverride<string[]>(PERMISOS, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (!requeridos || requeridos.length === 0) return true;

    const usuario: UsuarioAutenticado = contexto.switchToHttp().getRequest().user;
    if (!usuario) throw new ForbiddenException('Usuario no autenticado');

    const faltantes = requeridos.filter((p) => !usuario.permisos?.includes(p));
    if (faltantes.length) {
      throw new ForbiddenException(`Permisos insuficientes. Faltan: ${faltantes.join(', ')}`);
    }
    return true;
  }
}
