import { Controller, Get, Query } from '@nestjs/common';
import { gestor } from '../../common/contexto/contexto-peticion';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('auditoria')
export class AuditoriaController {
  /**
   * Sólo lectura, y a propósito: no hay endpoint para escribir en la bitácora.
   * Lo que llega aquí lo puso el interceptor global, no una llamada de negocio.
   */
  @Get()
  @RequierePermisos('auditoria:leer')
  listar(
    @Query('entidad') entidad?: string,
    @Query('usuarioId') usuarioId?: string,
    @Query('limite') limite = '100',
  ) {
    const tope = Math.min(Math.max(parseInt(limite, 10) || 100, 1), 500);
    return gestor().query(
      `SELECT auditoria_id AS id, usuario_id AS "usuarioId", accion, entidad,
              entidad_id AS "entidadId", valor_anterior AS "valorAnterior",
              valor_nuevo AS "valorNuevo", motivo, ip, dispositivo, ruta,
              ocurrido_en AS "ocurridoEn"
         FROM auditoria
        WHERE ($1::text IS NULL OR entidad = $1)
          AND ($2::bigint IS NULL OR usuario_id = $2)
        ORDER BY ocurrido_en DESC
        LIMIT $3`,
      [entidad ?? null, usuarioId ?? null, tope],
    );
  }
}
