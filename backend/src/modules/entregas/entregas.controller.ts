import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { EntregasService } from './entregas.service';
import { RegistrarEntregaDto, AprobarEntregaDto, RechazarEntregaDto } from './dto/entregas.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('entregas')
export class EntregasController {
  constructor(private readonly entregas: EntregasService) {}

  @Get('viaje/:viajeId') @RequierePermisos('entregas:leer')
  listarDeViaje(@Param('viajeId') viajeId: string) {
    return this.entregas.listarDeViaje(viajeId);
  }

  @Get(':id') @RequierePermisos('entregas:leer')
  obtener(@Param('id') id: string) { return this.entregas.obtener(id); }

  /* La entrega se registra CONTRA UN VIAJE, y por eso el viaje va en la ruta y
     no en el cuerpo: es la relación que la regla 7 exige, y ponerla en el
     cuerpo la volvería un dato más que alguien puede equivocarse al mandar. */
  @Post('viaje/:viajeId') @RequierePermisos('entregas:crear')
  registrar(@Param('viajeId') viajeId: string, @Body() dto: RegistrarEntregaDto) {
    return this.entregas.registrar(viajeId, dto);
  }

  /* Permiso PROPIO, distinto de `entregas:crear`. Quien captura la entrega no
     puede ser quien perdona su diferencia de volumen: es la separación del §7
     —el riesgo de este negocio es el fraude de volumen— aplicada al punto donde
     ese fraude se materializa. Mismo criterio que `viajes:autorizar`. */
  @Post(':id/aprobar') @RequierePermisos('entregas:aprobar')
  aprobar(@Param('id') id: string, @Body() dto: AprobarEntregaDto) {
    return this.entregas.aprobar(id, dto);
  }

  @Post(':id/rechazar') @RequierePermisos('entregas:aprobar')
  rechazar(@Param('id') id: string, @Body() dto: RechazarEntregaDto) {
    return this.entregas.rechazar(id, dto);
  }
}
