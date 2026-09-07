import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { LiquidacionesService } from './liquidaciones.service';
import {
  CalcularLiquidacionDto, AprobarLiquidacionDto, PagarLiquidacionDto,
} from './dto/liquidaciones.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('liquidaciones')
export class LiquidacionesController {
  constructor(private readonly liquidaciones: LiquidacionesService) {}

  @Get() @RequierePermisos('liquidaciones:leer')
  listar(@Query('estado') estado?: string) { return this.liquidaciones.listar(estado); }

  /* Antes que `:id`: si no, Express leería «viaje» como un identificador. */
  @Get('viaje/:viajeId') @RequierePermisos('liquidaciones:leer')
  deViaje(@Param('viajeId') viajeId: string) { return this.liquidaciones.deViaje(viajeId); }

  @Get(':id') @RequierePermisos('liquidaciones:leer')
  obtener(@Param('id') id: string) { return this.liquidaciones.obtener(id); }

  @Post('viaje/:viajeId') @RequierePermisos('liquidaciones:calcular')
  calcular(@Param('viajeId') viajeId: string, @Body() dto: CalcularLiquidacionDto) {
    return this.liquidaciones.calcular(viajeId, dto);
  }

  /* Tres permisos y no uno: calcular, firmar el importe y mover el dinero son
     tres actos. El §7.18 le da a la aprobación y al pago fechas separadas
     justamente porque lo son. */
  @Post(':id/aprobar') @RequierePermisos('liquidaciones:aprobar')
  aprobar(@Param('id') id: string, @Body() dto: AprobarLiquidacionDto) {
    return this.liquidaciones.aprobar(id, dto);
  }

  @Post(':id/pagar') @RequierePermisos('liquidaciones:pagar')
  pagar(@Param('id') id: string, @Body() dto: PagarLiquidacionDto) {
    return this.liquidaciones.pagar(id, dto);
  }
}
