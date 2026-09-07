import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { GpsService } from './gps.service';
import { LotePosicionesDto } from './dto/gps.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';
import { SinIdempotencia } from '../../common/decorators/sin-idempotencia.decorator';

@Controller('gps')
export class GpsController {
  constructor(private readonly gps: GpsService) {}

  /* `@SinIdempotencia` por lo mismo que la sincronizacion de eventos: exigir una
     clave de peticion a un flujo que manda un lote cada pocos segundos, cada
     uno distinto del anterior, solo anadiria una fila de `claves_idempotencia`
     por cada lote y ninguna proteccion. Una posicion repetida no hace dano: es
     el mismo punto en el mismo instante. */
  @Post('posiciones') @SinIdempotencia() @RequierePermisos('gps:ingerir')
  ingerir(@Body() lote: LotePosicionesDto) { return this.gps.ingerir(lote); }

  @Get('flota') @RequierePermisos('gps:leer')
  flota() { return this.gps.flotaEnRuta(); }

  @Get('viaje/:viajeId/ultima') @RequierePermisos('gps:leer')
  ultima(@Param('viajeId') viajeId: string) { return this.gps.ultimaDe(viajeId); }

  @Get('viaje/:viajeId/recorrido') @RequierePermisos('gps:leer')
  recorrido(@Param('viajeId') viajeId: string, @Query('limite') limite = '1000') {
    const tope = Math.min(Math.max(parseInt(limite, 10) || 1000, 1), 5000);
    return this.gps.recorridoDe(viajeId, tope);
  }

  @Get('viaje/:viajeId/kilometros') @RequierePermisos('gps:leer')
  kilometros(@Param('viajeId') viajeId: string) { return this.gps.kilometrosDe(viajeId); }
}
