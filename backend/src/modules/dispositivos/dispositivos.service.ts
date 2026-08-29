import { Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { TokensService } from '../auth/tokens.service';

@Injectable()
export class DispositivosService {
  constructor(private readonly tokens: TokensService) {}

  listar() {
    return gestor().query(
      `SELECT d.dispositivo_id AS id, d.identificador, d.nombre, d.plataforma,
              d.ultimo_uso_en AS "ultimoUsoEn", d.revocado_en AS "revocadoEn",
              u.nombre AS usuario
         FROM dispositivos d JOIN usuarios u ON u.usuario_id = d.usuario_id
        ORDER BY d.ultimo_uso_en DESC NULLS LAST`,
    );
  }

  /**
   * Revocar es una operación en dos mundos: la marca en Postgres impide futuros
   * logins, y el borrado en Redis corta las sesiones YA abiertas. Sin lo
   * segundo, un equipo robado sigue operando hasta que venza su access token.
   */
  async revocar(id: string, motivo: string) {
    const ctx = contextoActual();
    const [dispositivo] = await gestor().query(
      `SELECT dispositivo_id, identificador, revocado_en FROM dispositivos WHERE dispositivo_id = $1`,
      [id],
    );
    if (!dispositivo) throw new NotFoundException('Dispositivo no encontrado');

    await gestor().query(
      `UPDATE dispositivos SET revocado_en = now(), revocado_por = $2 WHERE dispositivo_id = $1`,
      [id, ctx.usuarioId],
    );
    const sesiones = await this.tokens.revocarDispositivo(ctx.empresaId, id);

    auditar({
      entidad: 'dispositivos', entidadId: id, motivo,
      valorAnterior: { revocadoEn: dispositivo.revocado_en },
      valorNuevo: { revocadoEn: new Date().toISOString(), sesionesCortadas: sesiones },
    });
    return { id, revocado: true, sesionesCortadas: sesiones };
  }
}
