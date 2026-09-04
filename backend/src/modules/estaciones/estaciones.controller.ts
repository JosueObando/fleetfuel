import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { EstacionesService } from './estaciones.service';
import { CrearEstacionDto, ActualizarEstacionDto } from './dto/estaciones.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('estaciones')
export class EstacionesController {
  constructor(private readonly estaciones: EstacionesService) {}

  @Get()      @RequierePermisos('estaciones:leer') listar() { return this.estaciones.listar(); }
  @Get(':id') @RequierePermisos('estaciones:leer') obtener(@Param('id') id: string) { return this.estaciones.obtener(id); }
  @Post()     @RequierePermisos('estaciones:crear') crear(@Body() dto: CrearEstacionDto) { return this.estaciones.crear(dto); }

  @Patch(':id') @RequierePermisos('estaciones:actualizar')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarEstacionDto) { return this.estaciones.actualizar(id, dto); }

  @Delete(':id') @RequierePermisos('estaciones:desactivar')
  desactivar(@Param('id') id: string) { return this.estaciones.desactivar(id); }
}
