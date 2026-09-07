import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { GastosService } from './gastos.service';
import { RegistrarGastoDto, ResolverGastoDto } from './dto/gastos.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('gastos')
export class GastosController {
  constructor(private readonly gastos: GastosService) {}

  /* Antes que `:id`, o Express leería «pendientes» como un identificador. */
  @Get('pendientes') @RequierePermisos('gastos:leer')
  pendientes() { return this.gastos.pendientes(); }

  @Get('viaje/:viajeId') @RequierePermisos('gastos:leer')
  listarDeViaje(@Param('viajeId') viajeId: string) {
    return this.gastos.listarDeViaje(viajeId);
  }

  @Get('viaje/:viajeId/totales') @RequierePermisos('gastos:leer')
  totales(@Param('viajeId') viajeId: string) { return this.gastos.totales(viajeId); }

  @Get(':id') @RequierePermisos('gastos:leer')
  obtener(@Param('id') id: string) { return this.gastos.obtener(id); }

  @Post('viaje/:viajeId') @RequierePermisos('gastos:crear')
  registrar(@Param('viajeId') viajeId: string, @Body() dto: RegistrarGastoDto) {
    return this.gastos.registrar(viajeId, dto);
  }

  /* Permiso propio, y además el servicio impide que quien lo registró lo
     apruebe: si el conductor que pone el peaje pudiera aprobárselo, «gasto
     aprobado» no significaría nada. */
  @Patch(':id') @RequierePermisos('gastos:aprobar')
  resolver(@Param('id') id: string, @Body() dto: ResolverGastoDto) {
    return this.gastos.resolver(id, dto);
  }
}
