import { Controller, Get } from '@nestjs/common';
import { gestor } from '../../common/contexto/contexto-peticion';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('empresa')
export class EmpresasController {
  /**
   * Devuelve "la" empresa sin filtro ni parámetro: la RLS garantiza que sólo
   * hay una visible. Es la mejor demostración de ADR 003 que hay en el código.
   */
  @Get()
  @RequierePermisos('empresas:leer')
  async actual() {
    const [empresa] = await gestor().query(
      `SELECT empresa_id AS id, nombre, ruc, estado, creado_en AS "creadoEn" FROM empresas`,
    );
    return empresa;
  }
}
