import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface UsuarioAutenticado {
  id: string;
  empresaId: string;
  correo: string;
  roles: string[];
  permisos: string[];
  dispositivoId: string | null;
  /** `inscripcion-mfa` restringe la sesión a los endpoints de MFA (§7). */
  tipoSesion: 'acceso' | 'inscripcion-mfa';
}

/**
 * El resolutor, aparte del decorador, para que se pueda afirmar.
 *
 * `createParamDecorator` envuelve la función en metadatos de Nest y deja de
 * haber nada que llamar desde una prueba. Sacarla es el mismo criterio que ya
 * se aplicó a `listaDeProxiesDeConfianza`: lo que decide algo se prueba, y lo
 * que sólo lo conecta no necesita prueba.
 *
 * El `?.` no es adorno: una ruta `@Publico()` no pasa por JwtStrategy, así que
 * `request.user` no existe. Sin él, pedir un campo revienta con un TypeError
 * —un 500— en vez de devolver `undefined` y dejar que el controlador decida.
 */
export function resolverUsuarioActual(
  campo: keyof UsuarioAutenticado | undefined,
  ctx: ExecutionContext,
): unknown {
  const usuario: UsuarioAutenticado | undefined = ctx.switchToHttp().getRequest().user;
  return campo ? usuario?.[campo] : usuario;
}

/** Inyecta el usuario resuelto por JwtStrategy en el controlador. */
export const UsuarioActual = createParamDecorator(resolverUsuarioActual);
