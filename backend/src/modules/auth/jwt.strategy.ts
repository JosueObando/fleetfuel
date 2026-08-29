import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsuarioAutenticado } from '../../common/decorators/usuario-actual.decorator';

export interface CargaJwt {
  sub: string;
  emp: string;
  correo: string;
  roles: string[];
  permisos: string[];
  disp: string | null;
  /** Marca el token de refresco para que no sirva como token de acceso. */
  tipo?: 'acceso' | 'refresco';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret') as string,
    });
  }

  async validate(carga: CargaJwt): Promise<UsuarioAutenticado> {
    // Un refresh token está firmado con otro secreto, así que no debería llegar
    // aquí; la comprobación es barata y cubre el día que alguien unifique los
    // secretos "para simplificar".
    if (carga.tipo === 'refresco') {
      throw new UnauthorizedException('Este token es de refresco, no de acceso');
    }
    if (!carga.emp) throw new UnauthorizedException('Token sin empresa');
    return {
      id: carga.sub,
      empresaId: carga.emp,
      correo: carga.correo,
      roles: carga.roles ?? [],
      permisos: carga.permisos ?? [],
      dispositivoId: carga.disp ?? null,
    };
  }
}
