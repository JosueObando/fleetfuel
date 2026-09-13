import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CargasService } from './cargas.service';
import { RegistrarCargaDto, ValidarCargaDto } from './dto/cargas.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('cargas')
export class CargasController {
  constructor(private readonly cargas: CargasService) {}

  @Get('viaje/:viajeId') @RequierePermisos('cargas:leer')
  listarDeViaje(@Param('viajeId') viajeId: string) {
    return this.cargas.listarDeViaje(viajeId);
  }

  @Get(':id') @RequierePermisos('cargas:leer')
  obtener(@Param('id') id: string) { return this.cargas.obtener(id); }

  /* La carga se registra CONTRA UN VIAJE, igual que la entrega: es la relación
     que la hace existir, y en el cuerpo sería un dato más que equivocarse. */
  @Post('viaje/:viajeId') @RequierePermisos('cargas:registrar')
  registrar(@Param('viajeId') viajeId: string, @Body() dto: RegistrarCargaDto) {
    return this.cargas.registrar(viajeId, dto);
  }

  /* Permiso PROPIO, distinto de `cargas:registrar`. Quien confirma el volumen
     que salió de la terminal no puede ser quien da por buena su propia
     confirmación: es la misma separación que `entregas:aprobar` y
     `viajes:autorizar`, aplicada al punto donde nace la cadena de custodia. */
  @Post(':id/validar') @RequierePermisos('cargas:validar')
  validar(@Param('id') id: string, @Body() dto: ValidarCargaDto) {
    return this.cargas.validar(id, dto);
  }

  @Post(':id/rechazar') @RequierePermisos('cargas:validar')
  rechazar(@Param('id') id: string, @Body() dto: ValidarCargaDto) {
    return this.cargas.rechazar(id, dto);
  }
}
