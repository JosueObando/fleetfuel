import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import { CifradoService } from './cifrado.service';
import { auditar, gestor } from '../../common/contexto/contexto-peticion';

@Injectable()
export class MfaService {
  constructor(
    private readonly cifrado: CifradoService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Genera un secreto y lo guarda cifrado, pero SIN habilitar el MFA todavía.
   *
   * El orden importa: si se habilitara aquí, un usuario que pierde la app de
   * autenticación entre este paso y el siguiente queda fuera de su cuenta sin
   * haber llegado a configurarla. Se habilita sólo cuando demuestra que puede
   * generar un código válido.
   */
  async iniciar(usuarioId: string, correo: string) {
    const secreto = authenticator.generateSecret();
    await gestor().query(
      `UPDATE usuarios SET mfa_secreto = $2, actualizado_en = now() WHERE usuario_id = $1`,
      [usuarioId, this.cifrado.cifrar(secreto)],
    );
    auditar({ entidad: 'usuarios', entidadId: usuarioId, valorNuevo: { mfa: 'secreto generado' } });
    return {
      secreto,
      otpauth: authenticator.keyuri(correo, this.config.get<string>('mfa.emisor') ?? 'FleetFuel', secreto),
      siguiente: 'Escanea el código y confirma con POST /auth/mfa/confirmar',
    };
  }

  async confirmar(usuarioId: string, codigo: string) {
    const [fila] = await gestor().query(
      `SELECT mfa_secreto FROM usuarios WHERE usuario_id = $1`,
      [usuarioId],
    );
    if (!fila) throw new NotFoundException('Usuario no encontrado');
    if (!fila.mfa_secreto) throw new BadRequestException('Primero llama a POST /auth/mfa/iniciar');

    if (!authenticator.check(codigo, this.cifrado.descifrar(fila.mfa_secreto))) {
      throw new BadRequestException('Código incorrecto. Revisa la hora del dispositivo.');
    }
    await gestor().query(
      `UPDATE usuarios SET mfa_habilitado = true, mfa_confirmado_en = now(), actualizado_en = now()
        WHERE usuario_id = $1`,
      [usuarioId],
    );
    auditar({
      entidad: 'usuarios', entidadId: usuarioId,
      valorAnterior: { mfaHabilitado: false }, valorNuevo: { mfaHabilitado: true },
    });
    return { mfaHabilitado: true };
  }

  /** §7: los perfiles administrativos no son opcionales en esto. */
  async exigidoPara(roles: string[]): Promise<boolean> {
    const obligatorios = this.config.get<string[]>('mfa.rolesObligatorios') ?? [];
    return roles.some((r) => obligatorios.includes(r));
  }
}
