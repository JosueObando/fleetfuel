import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ViajesService } from './viajes.service';
import {
  CrearViajeDto, ActualizarViajeDto, CambiarEstadoViajeDto, AsignarOrdenDto, LineaPlanDto,
} from './dto/viajes.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('viajes')
export class ViajesController {
  constructor(private readonly viajes: ViajesService) {}

  @Get() @RequierePermisos('viajes:leer')
  listar(@Query('estado') estado?: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.viajes.listar(estado, { desde, hasta });
  }

  @Get(':id') @RequierePermisos('viajes:leer')
  obtener(@Param('id') id: string) { return this.viajes.obtener(id); }

  @Post() @RequierePermisos('viajes:crear')
  crear(@Body() dto: CrearViajeDto) { return this.viajes.crear(dto); }

  @Patch(':id') @RequierePermisos('viajes:actualizar')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarViajeDto) {
    return this.viajes.actualizar(id, dto);
  }

  @Patch(':id/estado') @RequierePermisos('viajes:actualizar')
  cambiarEstado(@Param('id') id: string, @Body() dto: CambiarEstadoViajeDto) {
    return this.viajes.cambiarEstado(id, dto);
  }

  /* Permiso PROPIO, distinto de viajes:actualizar. Quien planifica el viaje
     no lo autoriza: es el control contra el fraude interno del §7. */
  @Post(':id/autorizar') @RequierePermisos('viajes:autorizar')
  autorizar(@Param('id') id: string) { return this.viajes.autorizar(id); }

  @Post(':id/ordenes') @RequierePermisos('viajes:actualizar')
  asignarOrden(@Param('id') id: string, @Body() dto: AsignarOrdenDto) {
    return this.viajes.asignarOrden(id, dto);
  }

  @Post(':id/plan-carga') @RequierePermisos('plancarga:crear')
  agregarLinea(@Param('id') id: string, @Body() dto: LineaPlanDto) {
    return this.viajes.agregarLineaPlan(id, dto);
  }

  @Delete(':id/plan-carga/:planId') @RequierePermisos('plancarga:actualizar')
  quitarLinea(@Param('id') id: string, @Param('planId') planId: string) {
    return this.viajes.quitarLineaPlan(id, planId);
  }
}
