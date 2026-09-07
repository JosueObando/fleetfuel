import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AlertasService } from './alertas.service';
import { GeocercasService } from './geocercas.service';
import { CrearGeocercaDto, ResolverAlertaDto } from './dto/alertas.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';
import { SinIdempotencia } from '../../common/decorators/sin-idempotencia.decorator';

@Controller('alertas')
export class AlertasController {
  constructor(private readonly alertas: AlertasService) {}

  @Get() @RequierePermisos('alertas:leer')
  listar(@Query('estado') estado?: string) { return this.alertas.listar(estado); }

  @Get(':id') @RequierePermisos('alertas:leer')
  obtener(@Param('id') id: string) { return this.alertas.obtener(id); }

  /* `@SinIdempotencia`: la evaluacion ES idempotente por su propia
     construccion —cada hallazgo trae su clave de deduplicacion—, asi que
     exigir una clave de peticion solo anadiria una fila por cada pasada. */
  @Post('evaluar') @SinIdempotencia() @RequierePermisos('alertas:evaluar')
  evaluar() { return this.alertas.evaluar(); }

  @Post(':id/reconocer') @RequierePermisos('alertas:resolver')
  reconocer(@Param('id') id: string) { return this.alertas.reconocer(id); }

  @Post(':id/resolver') @RequierePermisos('alertas:resolver')
  resolver(@Param('id') id: string, @Body() dto: ResolverAlertaDto) {
    return this.alertas.resolver(id, dto);
  }
}

@Controller('geocercas')
export class GeocercasController {
  constructor(private readonly geocercas: GeocercasService) {}

  @Get() @RequierePermisos('geocercas:leer')
  listar() { return this.geocercas.listar(); }

  @Get('viaje/:viajeId') @RequierePermisos('geocercas:leer')
  dondeEsta(@Param('viajeId') viajeId: string) { return this.geocercas.dondeEsta(viajeId); }

  @Get(':id') @RequierePermisos('geocercas:leer')
  obtener(@Param('id') id: string) { return this.geocercas.obtener(id); }

  @Post() @RequierePermisos('geocercas:administrar')
  crear(@Body() dto: CrearGeocercaDto) { return this.geocercas.crear(dto); }
}
