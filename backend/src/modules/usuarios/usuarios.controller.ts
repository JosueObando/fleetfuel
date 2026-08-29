import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { CrearUsuarioDto } from './dto/crear-usuario.dto';
import { SuspenderUsuarioDto } from './dto/suspender-usuario.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  @RequierePermisos('usuarios:leer')
  listar() { return this.usuarios.listar(); }

  @Post()
  @RequierePermisos('usuarios:crear')
  crear(@Body() dto: CrearUsuarioDto) { return this.usuarios.crear(dto); }

  @Patch(':id/suspender')
  @RequierePermisos('usuarios:suspender')
  suspender(@Param('id') id: string, @Body() dto: SuspenderUsuarioDto) {
    return this.usuarios.suspender(id, dto.motivo);
  }
}
