import {
  ForbiddenException, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { compare } from 'bcryptjs';
import { authenticator } from 'otplib';
import { CifradoService } from './cifrado.service';
import { TokensService } from './tokens.service';
import { CargaJwt } from './jwt.strategy';
import { LoginDto } from './dto/login.dto';
import { Contexto, ejecutarEnContexto } from '../../common/contexto/contexto-peticion';

export interface SesionEmitida {
  accessToken: string;
  refreshToken: string;
  expiraEn: string;
  usuario: { id: string; nombre: string; correo: string; empresaId: string; roles: string[]; permisos: string[] };
}

interface FilaLogin {
  empresa_id: string;
  usuario_id: string;
  nombre: string;
  hash_clave: string;
  estado: string;
  mfa_habilitado: boolean;
  mfa_secreto: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly cifrado: CifradoService,
    private readonly tokens: TokensService,
  ) {}

  async login(dto: LoginDto, ip?: string): Promise<SesionEmitida> {
    const [fila]: FilaLogin[] = await this.dataSource.query(
      `SELECT * FROM fn_login_resolver($1)`,
      [dto.correo],
    );

    // Un solo mensaje para "no existe" y "clave incorrecta": distinguirlos
    // convierte el login en un oráculo de qué correos están registrados.
    const generico = new UnauthorizedException('Credenciales inválidas');
    if (!fila) {
      // Se compara igual contra un hash de descarte para no filtrar por tiempo
      // de respuesta que el correo no existe.
      await compare(dto.clave, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
      throw generico;
    }
    if (!(await compare(dto.clave, fila.hash_clave))) throw generico;
    if (fila.estado !== 'activo') throw new ForbiddenException('Usuario suspendido');

    await this.verificarMfa(fila, dto.codigoTotp);

    // A partir de aquí ya se conoce la empresa: todo lo demás corre con el
    // contexto fijado, igual que cualquier otra petición.
    return this.enContextoDe(fila.empresa_id, fila.usuario_id, ip, async (ctx) => {
      const { roles, permisos } = await this.rolesYPermisos(ctx, fila.usuario_id);
      const dispositivoId = dto.dispositivo
        ? await this.registrarDispositivo(ctx, fila, dto)
        : null;

      await ctx.manager.query(
        `UPDATE usuarios SET ultimo_acceso_en = now() WHERE usuario_id = $1`,
        [fila.usuario_id],
      );
      await ctx.manager.query(
        `INSERT INTO auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, ip, ruta)
         VALUES ($1,$2,'login','usuarios',$3,$4::inet,'POST /auth/login')`,
        [fila.empresa_id, fila.usuario_id, fila.usuario_id, ip ?? null],
      );

      return this.emitir(fila, roles, permisos, dispositivoId);
    });
  }

  async refrescar(refreshToken: string): Promise<SesionEmitida> {
    let carga: CargaJwt & { jti?: string };
    try {
      carga = this.jwt.verify(refreshToken, { secret: this.config.get<string>('jwt.refreshSecret') });
    } catch {
      throw new UnauthorizedException('Token de refresco inválido o vencido');
    }
    if (carga.tipo !== 'refresco' || !carga.jti) {
      throw new UnauthorizedException('Ese token no sirve para refrescar');
    }
    // La firma sólo dice que el token es auténtico. Lo que dice si SIGUE siendo
    // válido es Redis: ahí es donde muerden el logout y la revocación de un
    // dispositivo (§7).
    if (!(await this.tokens.vigente(carga.jti))) {
      throw new UnauthorizedException('Sesión revocada. Inicia sesión de nuevo.');
    }

    return this.enContextoDe(carga.emp, carga.sub, undefined, async (ctx) => {
      const [usuario] = await ctx.manager.query(
        `SELECT usuario_id, empresa_id, nombre, estado FROM usuarios
          WHERE usuario_id = $1 AND eliminado_en IS NULL`,
        [carga.sub],
      );
      if (!usuario || usuario.estado !== 'activo') {
        await this.tokens.revocar(carga.jti as string);
        throw new UnauthorizedException('Usuario no disponible');
      }
      if (carga.disp && (await this.dispositivoRevocado(ctx, carga.disp))) {
        await this.tokens.revocar(carga.jti as string);
        throw new UnauthorizedException('Dispositivo revocado');
      }

      const { roles, permisos } = await this.rolesYPermisos(ctx, carga.sub);
      // Rotación: el refresh usado se invalida al emitir el siguiente, para que
      // un token robado sirva una vez y su uso delate al ladrón o al legítimo.
      await this.tokens.revocar(carga.jti as string);
      return this.emitir(
        { empresa_id: usuario.empresa_id, usuario_id: usuario.usuario_id, nombre: usuario.nombre } as FilaLogin,
        roles, permisos, carga.disp ?? null,
      );
    });
  }

  async cerrarSesion(refreshToken: string): Promise<void> {
    try {
      const carga = this.jwt.verify<CargaJwt & { jti?: string }>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
      if (carga.jti) await this.tokens.revocar(carga.jti);
    } catch {
      // Cerrar sesión con un token ya vencido es el resultado deseado.
    }
  }

  // ── MFA (§7) ──────────────────────────────────────────────────────────────

  private async verificarMfa(fila: FilaLogin, codigo?: string): Promise<void> {
    if (!fila.mfa_habilitado) return;
    if (!codigo) throw new UnauthorizedException('Se requiere el código MFA');
    if (!fila.mfa_secreto) throw new ForbiddenException('MFA habilitado sin secreto configurado');
    const secreto = this.cifrado.descifrar(fila.mfa_secreto);
    if (!authenticator.check(codigo, secreto)) {
      throw new UnauthorizedException('Código MFA incorrecto');
    }
  }

  // ── apoyo ─────────────────────────────────────────────────────────────────

  private async rolesYPermisos(ctx: Contexto, usuarioId: string) {
    const filas: Array<{ rol: string; permiso: string | null }> = await ctx.manager.query(
      `SELECT r.nombre AS rol, p.codigo AS permiso
         FROM usuarios_roles ur
         JOIN roles r ON r.rol_id = ur.rol_id
         LEFT JOIN roles_permisos rp ON rp.rol_id = r.rol_id
         LEFT JOIN permisos p ON p.permiso_id = rp.permiso_id
        WHERE ur.usuario_id = $1`,
      [usuarioId],
    );
    return {
      roles: [...new Set(filas.map((f) => f.rol))],
      permisos: [...new Set(filas.map((f) => f.permiso).filter((p): p is string => !!p))],
    };
  }

  private async registrarDispositivo(ctx: Contexto, fila: FilaLogin, dto: LoginDto): Promise<string> {
    const [d] = await ctx.manager.query(
      `INSERT INTO dispositivos (empresa_id, usuario_id, identificador, nombre, ultimo_uso_en)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (usuario_id, identificador)
       DO UPDATE SET ultimo_uso_en = now(), nombre = COALESCE(EXCLUDED.nombre, dispositivos.nombre)
       RETURNING dispositivo_id, revocado_en`,
      [fila.empresa_id, fila.usuario_id, dto.dispositivo, dto.dispositivoNombre ?? null],
    );
    if (d.revocado_en) throw new ForbiddenException('Este dispositivo fue revocado');
    return String(d.dispositivo_id);
  }

  private async dispositivoRevocado(ctx: Contexto, dispositivoId: string): Promise<boolean> {
    const [d] = await ctx.manager.query(
      `SELECT revocado_en FROM dispositivos WHERE dispositivo_id = $1`,
      [dispositivoId],
    );
    return !d || !!d.revocado_en;
  }

  private async emitir(
    fila: Pick<FilaLogin, 'empresa_id' | 'usuario_id' | 'nombre'>,
    roles: string[],
    permisos: string[],
    dispositivoId: string | null,
  ): Promise<SesionEmitida> {
    const base: CargaJwt = {
      sub: String(fila.usuario_id),
      emp: String(fila.empresa_id),
      correo: '',
      roles, permisos,
      disp: dispositivoId,
      tipo: 'acceso',
    };
    const jti = await this.tokens.registrar({
      usuarioId: String(fila.usuario_id),
      empresaId: String(fila.empresa_id),
      dispositivoId,
    });

    return {
      accessToken: this.jwt.sign(base, {
        secret: this.config.get<string>('jwt.secret'),
        expiresIn: this.config.get<string>('jwt.expiresIn'),
      }),
      refreshToken: this.jwt.sign(
        { ...base, tipo: 'refresco', jti, permisos: [], roles: [] },
        {
          secret: this.config.get<string>('jwt.refreshSecret'),
          expiresIn: this.config.get<string>('jwt.refreshExpiresIn'),
        },
      ),
      expiraEn: this.config.get<string>('jwt.expiresIn') ?? '15m',
      usuario: {
        id: String(fila.usuario_id),
        nombre: fila.nombre,
        correo: '',
        empresaId: String(fila.empresa_id),
        roles, permisos,
      },
    };
  }

  /** Abre una transacción con el contexto de empresa fijado, igual que hace el
   *  interceptor para las rutas autenticadas. El login no puede usar aquél
   *  porque todavía no hay `request.user` cuando se ejecuta. */
  private async enContextoDe<T>(
    empresaId: string, usuarioId: string, ip: string | undefined,
    fn: (ctx: Contexto) => Promise<T>,
  ): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(`SELECT set_config('app.empresa_id', $1, true)`, [String(empresaId)]);
      await runner.query(`SELECT set_config('app.usuario_id', $1, true)`, [String(usuarioId)]);
      const ctx: Contexto = {
        empresaId: String(empresaId), usuarioId: String(usuarioId),
        manager: runner.manager, ip, cambios: [],
      };
      const salida = await ejecutarEnContexto(ctx, () => fn(ctx));
      await runner.commitTransaction();
      return salida;
    } catch (e) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw e;
    } finally {
      await runner.release();
    }
  }
}
