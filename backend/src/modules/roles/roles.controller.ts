import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CrearRolDto, DefinirPermisosDto } from './dto/rol.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles')
  @RequierePermisos('roles:leer')
  listar() { return this.roles.listar(); }

  @Get('permisos')
  @RequierePermisos('roles:leer')
  catalogo() { return this.roles.catalogoPermisos(); }

  @Post('roles')
  @RequierePermisos('roles:administrar')
  crear(@Body() dto: CrearRolDto) {
    return this.roles.crear(dto.nombre, dto.descripcion ?? null, dto.exigeMfa ?? false);
  }

  @Put('roles/:id/permisos')
  @RequierePermisos('roles:administrar')
  definir(@Param('id') id: string, @Body() dto: DefinirPermisosDto) {
    return this.roles.definirPermisos(id, dto.permisos);
  }
}
