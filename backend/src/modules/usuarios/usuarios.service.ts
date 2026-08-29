import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { CrearUsuarioDto } from './dto/crear-usuario.dto';

const COSTO_BCRYPT = 12;

@Injectable()
export class UsuariosService {
  /**
   * No hay `WHERE empresa_id = ...` en ninguna consulta de este servicio, y no
   * es un olvido: lo pone la RLS. Si mañana alguien añade un método sin el
   * filtro, sigue estando aislado. Ése es exactamente el valor de ADR 003 —
   * que el aislamiento no dependa de la disciplina de quien escribe la query.
   */
  listar() {
    return gestor().query(
      `SELECT u.usuario_id AS id, u.nombre, u.correo, u.estado,
              u.mfa_habilitado AS "mfaHabilitado", u.ultimo_acceso_en AS "ultimoAccesoEn",
              coalesce(array_agg(r.nombre) FILTER (WHERE r.nombre IS NOT NULL), '{}') AS roles
         FROM usuarios u
         LEFT JOIN usuarios_roles ur ON ur.usuario_id = u.usuario_id
         LEFT JOIN roles r ON r.rol_id = ur.rol_id
        WHERE u.eliminado_en IS NULL
        GROUP BY u.usuario_id
        ORDER BY u.nombre`,
    );
  }

  async crear(dto: CrearUsuarioDto) {
    const ctx = contextoActual();
    const [existente] = await gestor().query(
      `SELECT usuario_id FROM usuarios WHERE lower(correo) = lower($1) AND eliminado_en IS NULL`,
      [dto.correo],
    );
    if (existente) throw new ConflictException('Ya existe un usuario con ese correo');

    const [creado] = await gestor().query(
      `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave, telefono)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING usuario_id AS id, nombre, correo, estado`,
      [ctx.empresaId, dto.nombre, dto.correo, await hash(dto.clave, COSTO_BCRYPT), dto.telefono ?? null],
    );

    if (dto.roles?.length) await this.asignarRoles(creado.id, dto.roles);

    auditar({
      entidad: 'usuarios', entidadId: String(creado.id),
      valorNuevo: { nombre: dto.nombre, correo: dto.correo, roles: dto.roles ?? [] },
    });
    return creado;
  }

  async suspender(id: string, motivo: string) {
    const [antes] = await gestor().query(
      `SELECT usuario_id, estado FROM usuarios WHERE usuario_id = $1 AND eliminado_en IS NULL`,
      [id],
    );
    if (!antes) throw new NotFoundException('Usuario no encontrado');

    await gestor().query(
      `UPDATE usuarios SET estado = 'suspendido', actualizado_en = now() WHERE usuario_id = $1`,
      [id],
    );
    auditar({
      entidad: 'usuarios', entidadId: id, motivo,
      valorAnterior: { estado: antes.estado }, valorNuevo: { estado: 'suspendido' },
    });
    return { id, estado: 'suspendido' };
  }

  private async asignarRoles(usuarioId: string, roles: string[]) {
    const filas = await gestor().query(
      `SELECT rol_id FROM roles WHERE nombre = ANY($1::text[])`,
      [roles],
    );
    if (filas.length !== roles.length) {
      throw new NotFoundException('Algún rol indicado no existe en esta empresa');
    }
    for (const { rol_id } of filas) {
      await gestor().query(
        `INSERT INTO usuarios_roles (usuario_id, rol_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [usuarioId, rol_id],
      );
    }
  }
}
