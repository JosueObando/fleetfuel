import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ConductoresService } from './conductores.service';
import { CrearConductorDto, ActualizarConductorDto } from './dto/conductores.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('conductores')
export class ConductoresController {
  constructor(private readonly conductores: ConductoresService) {}

  @Get() @RequierePermisos('conductores:leer') listar() { return this.conductores.listar(); }

  /* Antes de `:id`: si fuera después, Nest intentaría interpretar
     «licencias-por-vencer» como un identificador. */
  @Get('licencias-por-vencer') @RequierePermisos('conductores:leer')
  porVencer(@Query('dias', new ParseIntPipe({ optional: true })) dias?: number) {
    return this.conductores.porVencer(dias ?? 30);
  }

  @Get(':id') @RequierePermisos('conductores:leer') obtener(@Param('id') id: string) { return this.conductores.obtener(id); }
  @Post()     @RequierePermisos('conductores:crear') crear(@Body() dto: CrearConductorDto) { return this.conductores.crear(dto); }

  @Patch(':id') @RequierePermisos('conductores:actualizar')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarConductorDto) { return this.conductores.actualizar(id, dto); }

  @Delete(':id') @RequierePermisos('conductores:desactivar')
  desactivar(@Param('id') id: string) { return this.conductores.desactivar(id); }
}
