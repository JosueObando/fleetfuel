import { Controller, Get, Query } from '@nestjs/common';
import { InformesService } from './informes.service';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';
import { FechaDeConsultaPipe } from '../../common/fecha-de-consulta.pipe';

@Controller('informes')
export class InformesController {
  constructor(private readonly informes: InformesService) {}

  @Get('operativo') @RequierePermisos('informes:leer')
  operativo(@Query('fecha', FechaDeConsultaPipe) fecha?: string) {
    return this.informes.operativo(fecha);
  }

  @Get('volumen') @RequierePermisos('informes:leer')
  volumen(@Query('desde', FechaDeConsultaPipe) desde?: string,
          @Query('hasta', FechaDeConsultaPipe) hasta?: string) {
    return this.informes.volumen(desde, hasta);
  }

  @Get('mermas') @RequierePermisos('informes:leer')
  mermas(@Query('agruparPor') agruparPor?: string) {
    // Se normaliza aquí y no en el servicio: un valor inventado en la cadena de
    // consulta escogería una clave que no existe en el mapa de agrupación y
    // reventaría con un TypeError, o sea un 500 por un dato del cliente.
    const valido = ['conductor', 'cisterna', 'producto'].includes(agruparPor ?? '');
    return this.informes.mermas((valido ? agruparPor : 'conductor') as never);
  }

  @Get('recorridos') @RequierePermisos('informes:leer')
  recorridos(@Query('limite') limite = '100') {
    const tope = Math.min(Math.max(parseInt(limite, 10) || 100, 1), 500);
    return this.informes.recorridos(tope);
  }

  /** §15.1 · Las tarjetas del dashboard ejecutivo, del día de Panamá. */
  @Get('ejecutivo') @RequierePermisos('informes:leer')
  ejecutivo(@Query('fecha', FechaDeConsultaPipe) fecha?: string) {
    return this.informes.ejecutivo(fecha);
  }
}
