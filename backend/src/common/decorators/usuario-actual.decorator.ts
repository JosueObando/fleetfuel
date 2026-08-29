import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface UsuarioAutenticado {
  id: string;
  empresaId: string;
  correo: string;
  roles: string[];
  permisos: string[];
  dispositivoId: string | null;
}

/** Inyecta el usuario resuelto por JwtStrategy en el controlador. */
export const UsuarioActual = createParamDecorator(
  (campo: keyof UsuarioAutenticado | undefined, ctx: ExecutionContext) => {
    const usuario: UsuarioAutenticado = ctx.switchToHttp().getRequest().user;
    return campo ? usuario?.[campo] : usuario;
  },
);
