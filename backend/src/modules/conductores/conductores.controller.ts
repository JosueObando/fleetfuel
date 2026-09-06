import { Body, Controller, Delete, Get, Param, DefaultValuePipe, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
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
  /* `DefaultValuePipe` ANTES de `ParseIntPipe`, y no `ParseIntPipe({optional:true})`.
     Con la forma «optional» este endpoint respondía 400 «numeric string is
     expected» siempre que NO se pasaba `?dias=` — o sea, en su uso normal: el
     ParseIntPipe recibía el valor antes de poder descartarlo por nulo. La ruta
     existía, tenía su permiso y estaba declarada antes de `:id`; simplemente no
     se podía llamar. */
  porVencer(@Query('dias', new DefaultValuePipe(30), ParseIntPipe) dias: number) {
    return this.conductores.porVencer(dias);
  }

  @Get(':id') @RequierePermisos('conductores:leer') obtener(@Param('id') id: string) { return this.conductores.obtener(id); }
  @Post()     @RequierePermisos('conductores:crear') crear(@Body() dto: CrearConductorDto) { return this.conductores.crear(dto); }

  @Patch(':id') @RequierePermisos('conductores:actualizar')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarConductorDto) { return this.conductores.actualizar(id, dto); }

  @Delete(':id') @RequierePermisos('conductores:desactivar')
  desactivar(@Param('id') id: string) { return this.conductores.desactivar(id); }
}
