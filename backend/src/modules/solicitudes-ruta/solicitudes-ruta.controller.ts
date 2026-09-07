import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { SolicitudesRutaService } from './solicitudes-ruta.service';
import { PedirCambioRutaDto, ResolverCambioRutaDto } from './dto/solicitudes-ruta.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('solicitudes-ruta')
export class SolicitudesRutaController {
  constructor(private readonly solicitudes: SolicitudesRutaService) {}

  /* Lo primero que abre un despachador: lo que espera una decisión suya. Va
     antes que `:id` porque si no, Express leería «pendientes» como un id. */
  @Get('pendientes') @RequierePermisos('solicitudesruta:leer')
  pendientes() { return this.solicitudes.pendientes(); }

  @Get('viaje/:viajeId') @RequierePermisos('solicitudesruta:leer')
  listarDeViaje(@Param('viajeId') viajeId: string) {
    return this.solicitudes.listarDeViaje(viajeId);
  }

  @Get(':id') @RequierePermisos('solicitudesruta:leer')
  obtener(@Param('id') id: string) { return this.solicitudes.obtener(id); }

  @Post('viaje/:viajeId') @RequierePermisos('solicitudesruta:crear')
  pedir(@Param('viajeId') viajeId: string, @Body() dto: PedirCambioRutaDto) {
    return this.solicitudes.pedir(viajeId, dto);
  }

  /* Permiso PROPIO, y además el servicio impide que quien pidió resuelva: el
     permiso dice qué puede hacer un ROL, y la regla dice qué no puede hacer una
     PERSONA con su propia solicitud. Hacen falta las dos. */
  @Patch(':id') @RequierePermisos('solicitudesruta:resolver')
  resolver(@Param('id') id: string, @Body() dto: ResolverCambioRutaDto) {
    return this.solicitudes.resolver(id, dto);
  }
}
