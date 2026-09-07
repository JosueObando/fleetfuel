import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { EventosService } from './eventos.service';
import { RegistrarEventoDto, AnularEventoDto } from './dto/eventos.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('eventos')
export class EventosController {
  constructor(private readonly eventos: EventosService) {}

  @Get('viaje/:viajeId') @RequierePermisos('eventos:leer')
  listarDeViaje(@Param('viajeId') viajeId: string) {
    return this.eventos.listarDeViaje(viajeId);
  }

  /* La verificacion es una ruta y no un detalle interno a proposito: un hash
     que nadie puede comprobar desde fuera no prueba nada a nadie. */
  @Get('viaje/:viajeId/integridad') @RequierePermisos('eventos:leer')
  integridad(@Param('viajeId') viajeId: string) {
    return this.eventos.verificarIntegridad(viajeId);
  }

  @Get(':id') @RequierePermisos('eventos:leer')
  obtener(@Param('id') id: string) { return this.eventos.obtener(id); }

  @Post('viaje/:viajeId') @RequierePermisos('eventos:crear')
  registrar(@Param('viajeId') viajeId: string, @Body() dto: RegistrarEventoDto) {
    return this.eventos.registrar(viajeId, dto);
  }

  /* Permiso propio: registrar lo que pasa y retirar algo de la traza son actos
     distintos. Y «anular» aqui es anadir una correccion, nunca borrar. */
  @Post(':id/anular') @RequierePermisos('eventos:anular')
  anular(@Param('id') id: string, @Body() dto: AnularEventoDto) {
    return this.eventos.anular(id, dto);
  }
}
