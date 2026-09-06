import {
  ForbiddenException, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { compare, hashSync } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { authenticator } from 'otplib';
import { CifradoService } from './cifrado.service';
import { TokensService } from './tokens.service';
import { CargaJwt } from './jwt.strategy';
import { LoginDto } from './dto/login.dto';
import { Contexto, ejecutarEnContexto } from '../../common/contexto/contexto-peticion';
import { IntentosLoginService, MotivoDeFallo } from './intentos-login.service';

/**
 * §7: sesión mutilada para quien tiene un rol que exige TOTP y aún no lo
 * configuró. No lleva refreshToken a propósito: si lo llevara, `refrescar()`
 * la ascendería a sesión completa y el segundo factor quedaría esquivado con
 * una llamada más.
 */
export interface SesionInscripcionMfa {
  accessToken: string;
  expiraEn: string;
  debeInscribirMfa: true;
  siguiente: string;
  usuario: { id: string; nombre: string; correo: string; empresaId: string; roles: string[] };
}

export interface SesionEmitida {
  accessToken: string;
  refreshToken: string;
  expiraEn: string;
  usuario: { id: string; nombre: string; correo: string; empresaId: string; roles: string[]; permisos: string[] };
}

/**
 * Hash contra el que se compara cuando el correo NO existe, para que ese camino
 * cueste lo mismo que el bueno y el tiempo de respuesta no diga quién está
 * registrado.
 *
 * Tiene que ser un bcrypt VÁLIDO. Antes había una constante inventada
 * (`$2a$10$invalidinvalid…`) y no servía de nada: bcrypt la rechaza al parsear,
 * sin hacer ni una ronda. Medido: 0,15 ms contra los 85 ms de una comparación
 * de verdad. Esas dos cifras, a 550x de distancia, son un directorio de correos
 * legible desde fuera con un cronómetro — y el código parecía protegido,
 * porque la llamada a `compare` estaba ahí.
 *
 * Se genera al arrancar sobre bytes aleatorios: cuesta un bcrypt una sola vez y
 * garantiza a la vez que es válido y que nadie conoce su preimagen.
 */
const HASH_DE_DESCARTE = hashSync(randomBytes(32).toString('hex'), 10);

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
    private readonly intentos: IntentosLoginService,
  ) {}

  async login(dto: LoginDto, ip?: string): Promise<SesionEmitida | SesionInscripcionMfa> {
    const [fila]: FilaLogin[] = await this.dataSource.query(
      `SELECT * FROM fn_login_resolver($1)`,
      [dto.correo],
    );

    // Un solo mensaje para "no existe" y "clave incorrecta": distinguirlos
    // convierte el login en un oráculo de qué correos están registrados.
    const generico = new UnauthorizedException('Credenciales inválidas');
    if (!fila) {
      // Se compara igual contra un hash de descarte para que este camino cueste
      // lo mismo que el bueno. Ver HASH_DE_DESCARTE: la constante que había
      // aquí no era un bcrypt válido y la protección no existía.
      await compare(dto.clave, HASH_DE_DESCARTE);
      await this.anotarFallo(dto, ip, 'correo_desconocido');
      throw generico;
    }
    if (!(await compare(dto.clave, fila.hash_clave))) {
      await this.anotarFallo(dto, ip, 'clave_incorrecta', fila);
      throw generico;
    }
    if (fila.estado !== 'activo') {
      await this.anotarFallo(dto, ip, 'usuario_suspendido', fila);
      throw new ForbiddenException('Usuario suspendido');
    }

    // El motivo se calcula y se lanza aquí, en vez de que `verificarMfa` lance
    // por su cuenta: el registro necesita saber CUÁL de los tres fallos fue, y
    // deducirlo del mensaje de una excepción es de las cosas que se rompen sin
    // avisar el día que alguien mejore la redacción.
    const falloMfa = this.motivoDeMfaInvalido(fila, dto.codigoTotp);
    if (falloMfa) {
      await this.anotarFallo(dto, ip, falloMfa, fila);
      throw EXCEPCION_DE_MFA[falloMfa]();
    }

    // A partir de aquí ya se conoce la empresa: todo lo demás corre con el
    // contexto fijado, igual que cualquier otra petición.
    return this.enContextoDe(fila.empresa_id, fila.usuario_id, ip, async (ctx) => {
      const { roles, permisos, exigeMfa } = await this.rolesYPermisos(ctx, fila.usuario_id);
      const correo = await this.correoDe(ctx, fila.usuario_id);

      // §7: el rol exige segundo factor y el usuario todavía no lo configuró.
      // No se le puede negar la entrada —tiene que poder inscribirse alguna
      // vez— pero tampoco darle la sesión completa. Se le da una sesión que no
      // sirve para nada salvo configurar el TOTP.
      if (exigeMfa && !fila.mfa_habilitado) {
        await this.registrarAcceso(ctx, fila, ip, 'login-inscripcion-mfa');
        return {
          accessToken: this.firmarAcceso({
            sub: String(fila.usuario_id), emp: String(fila.empresa_id), correo,
            roles, permisos: [], disp: null, tipo: 'inscripcion-mfa',
          }),
          expiraEn: this.config.get<string>('jwt.expiresIn') ?? '15m',
          debeInscribirMfa: true,
          siguiente: 'POST /auth/mfa/iniciar y luego POST /auth/mfa/confirmar',
          usuario: {
            id: String(fila.usuario_id), nombre: fila.nombre, correo,
            empresaId: String(fila.empresa_id), roles,
          },
        };
      }

      const dispositivoId = dto.dispositivo
        ? await this.registrarDispositivo(ctx, fila, dto)
        : null;

      await this.registrarAcceso(ctx, fila, ip, 'login');

      return this.emitir(fila, correo, roles, permisos, dispositivoId);
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
        `SELECT usuario_id, empresa_id, nombre, estado, correo, mfa_habilitado FROM usuarios
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

      const { roles, permisos, exigeMfa } = await this.rolesYPermisos(ctx, carga.sub);

      // §7 otra vez, y no es redundante: entre el login y este refresco a este
      // usuario le pudieron asignar un rol que exige TOTP. Su refresh token
      // sigue siendo válido, así que sin esta comprobación refrescaría hacia
      // una sesión completa sin haberse inscrito nunca.
      if (exigeMfa && !usuario.mfa_habilitado) {
        await this.tokens.revocar(carga.jti as string);
        throw new UnauthorizedException(
          'Tu rol ahora exige segundo factor. Inicia sesión de nuevo para configurarlo.',
        );
      }

      // Rotación: el refresh usado se invalida al emitir el siguiente, para que
      // un token robado sirva una vez y su uso delate al ladrón o al legítimo.
      await this.tokens.revocar(carga.jti as string);
      return this.emitir(
        { empresa_id: usuario.empresa_id, usuario_id: usuario.usuario_id, nombre: usuario.nombre } as FilaLogin,
        usuario.correo ?? '',
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

  private motivoDeMfaInvalido(fila: FilaLogin, codigo?: string): MotivoDeMfa | null {
    if (!fila.mfa_habilitado) return null;
    if (!codigo) return 'mfa_ausente';
    if (!fila.mfa_secreto) return 'mfa_sin_secreto';
    const secreto = this.cifrado.descifrar(fila.mfa_secreto);
    return authenticator.check(codigo, secreto) ? null : 'mfa_incorrecto';
  }

  /**
   * Un intento fallido queda anotado ANTES de que suba la excepción, y con el
   * motivo real. Hacia fuera el mensaje sigue siendo genérico —«credenciales
   * inválidas» tanto si el correo no existe como si la clave está mal—, porque
   * distinguirlos convertiría el login en un oráculo de correos registrados.
   * Hacia dentro no: quien mira un ataque necesita esa distinción justamente
   * porque es la que no se le da al atacante.
   */
  private anotarFallo(
    dto: LoginDto, ip: string | undefined, motivo: MotivoDeFallo, fila?: FilaLogin,
  ): Promise<void> {
    return this.intentos.registrarFallo({
      correo: dto.correo,
      motivo,
      ip,
      empresaId: fila?.empresa_id,
      usuarioId: fila?.usuario_id,
    });
  }

  // ── apoyo ─────────────────────────────────────────────────────────────────

  private async rolesYPermisos(ctx: Contexto, usuarioId: string) {
    const filas: Array<{ rol: string; permiso: string | null; exige_mfa: boolean }> = await ctx.manager.query(
      `SELECT r.nombre AS rol, r.exige_mfa, p.codigo AS permiso
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
      // La columna `roles.exige_mfa` es la fuente de verdad del §7: es dato por
      // empresa y un administrador puede marcarla en un rol nuevo. La variable
      // MFA_ROLES_OBLIGATORIOS era una segunda regla, en paralelo y sin aplicar.
      exigeMfa: filas.some((f) => f.exige_mfa === true),
    };
  }

  /** El correo no viene de `fn_login_resolver`; dentro del contexto de empresa
   *  la RLS ya permite leerlo del usuario propio. */
  private async correoDe(ctx: Contexto, usuarioId: string): Promise<string> {
    const [u] = await ctx.manager.query(
      `SELECT correo FROM usuarios WHERE usuario_id = $1`, [usuarioId],
    );
    return u?.correo ?? '';
  }

  private async registrarAcceso(
    ctx: Contexto, fila: FilaLogin, ip: string | undefined, accion: string,
  ): Promise<void> {
    await ctx.manager.query(
      `UPDATE usuarios SET ultimo_acceso_en = now() WHERE usuario_id = $1`,
      [fila.usuario_id],
    );
    await ctx.manager.query(
      `INSERT INTO auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, ip, ruta)
       VALUES ($1,$2,$5,'usuarios',$3,$4::inet,'POST /auth/login')`,
      [fila.empresa_id, fila.usuario_id, fila.usuario_id, ip ?? null, accion],
    );
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

  /** Firma un token de acceso. Lo comparten la sesión normal y la de
   *  inscripción del §7; lo único que cambia entre ambas es la carga. */
  private firmarAcceso(carga: CargaJwt): string {
    return this.jwt.sign(carga, {
      secret: this.config.get<string>('jwt.secret'),
      expiresIn: this.config.get<string>('jwt.expiresIn'),
    });
  }

  private async emitir(
    fila: Pick<FilaLogin, 'empresa_id' | 'usuario_id' | 'nombre'>,
    correo: string,
    roles: string[],
    permisos: string[],
    dispositivoId: string | null,
  ): Promise<SesionEmitida> {
    const base: CargaJwt = {
      sub: String(fila.usuario_id),
      emp: String(fila.empresa_id),
      correo,
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
      accessToken: this.firmarAcceso(base),
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
        correo,
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

type MotivoDeMfa = Extract<MotivoDeFallo, `mfa_${string}`>;

/**
 * Los mismos mensajes y los mismos códigos que antes; lo único que cambia es
 * que ahora se eligen por motivo en vez de lanzarse desde tres sitios.
 */
const EXCEPCION_DE_MFA: Record<MotivoDeMfa, () => Error> = {
  mfa_ausente: () => new UnauthorizedException('Se requiere el código MFA'),
  mfa_sin_secreto: () => new ForbiddenException('MFA habilitado sin secreto configurado'),
  mfa_incorrecto: () => new UnauthorizedException('Código MFA incorrecto'),
};
