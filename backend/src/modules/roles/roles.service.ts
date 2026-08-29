import { Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';

@Injectable()
export class RolesService {
  listar() {
    return gestor().query(
      `SELECT r.rol_id AS id, r.nombre, r.descripcion, r.exige_mfa AS "exigeMfa",
              coalesce(array_agg(p.codigo) FILTER (WHERE p.codigo IS NOT NULL), '{}') AS permisos
         FROM roles r
         LEFT JOIN roles_permisos rp ON rp.rol_id = r.rol_id
         LEFT JOIN permisos p ON p.permiso_id = rp.permiso_id
        GROUP BY r.rol_id ORDER BY r.nombre`,
    );
  }

  catalogoPermisos() {
    return gestor().query(
      `SELECT codigo, descripcion, modulo FROM permisos ORDER BY modulo, codigo`,
    );
  }

  async definirPermisos(rolId: string, codigos: string[]) {
    const [rol] = await gestor().query(`SELECT rol_id, nombre FROM roles WHERE rol_id = $1`, [rolId]);
    if (!rol) throw new NotFoundException('Rol no encontrado');

    const antes = await gestor().query(
      `SELECT p.codigo FROM roles_permisos rp JOIN permisos p ON p.permiso_id = rp.permiso_id
        WHERE rp.rol_id = $1`, [rolId],
    );
    const permisos = await gestor().query(
      `SELECT permiso_id, codigo FROM permisos WHERE codigo = ANY($1::text[])`, [codigos],
    );
    const desconocidos = codigos.filter((c) => !permisos.some((p: any) => p.codigo === c));
    if (desconocidos.length) {
      throw new NotFoundException(`Permisos inexistentes: ${desconocidos.join(', ')}`);
    }

    // El rol de la aplicación no tiene DELETE (§7 regla 14), ni siquiera sobre
    // una tabla puente. Redefinir permisos se hace por diferencia, no por
    // borrar y reinsertar — y eso obliga a que el cambio quede explícito.
    const actuales = new Set(antes.map((a: any) => a.codigo));
    for (const p of permisos) {
      if (!actuales.has(p.codigo)) {
        await gestor().query(
          `INSERT INTO roles_permisos (rol_id, permiso_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [rolId, p.permiso_id],
        );
      }
    }
    const aQuitar = [...actuales].filter((c) => !codigos.includes(c as string));
    if (aQuitar.length) {
      throw new NotFoundException(
        `Quitar permisos (${aQuitar.join(', ')}) requiere una migración: la aplicación no ` +
        'tiene DELETE sobre roles_permisos por diseño (§7, regla 14).',
      );
    }

    auditar({
      entidad: 'roles', entidadId: rolId,
      valorAnterior: { permisos: [...actuales] }, valorNuevo: { permisos: codigos },
    });
    return { id: rolId, nombre: rol.nombre, permisos: codigos };
  }

  async crear(nombre: string, descripcion: string | null, exigeMfa: boolean) {
    const ctx = contextoActual();
    const [rol] = await gestor().query(
      `INSERT INTO roles (empresa_id, nombre, descripcion, exige_mfa) VALUES ($1,$2,$3,$4)
       RETURNING rol_id AS id, nombre, descripcion, exige_mfa AS "exigeMfa"`,
      [ctx.empresaId, nombre, descripcion, exigeMfa],
    );
    auditar({ entidad: 'roles', entidadId: String(rol.id), valorNuevo: { nombre, exigeMfa } });
    return rol;
  }
}
