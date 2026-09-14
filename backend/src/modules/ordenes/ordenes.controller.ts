import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { OrdenesService } from './ordenes.service';
import { CrearOrdenDto, ActualizarOrdenDto, CambiarEstadoOrdenDto } from './dto/ordenes.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('ordenes')
export class OrdenesController {
  constructor(private readonly ordenes: OrdenesService) {}

  @Get() @RequierePermisos('ordenes:leer')
  listar(@Query('estado') estado?: string, @Query('asignables') asignables?: string) {
    return this.ordenes.listar(estado, asignables === 'true');
  }

  @Get(':id') @RequierePermisos('ordenes:leer')
  obtener(@Param('id') id: string) { return this.ordenes.obtener(id); }

  @Post() @RequierePermisos('ordenes:crear')
  crear(@Body() dto: CrearOrdenDto) { return this.ordenes.crear(dto); }

  @Patch(':id') @RequierePermisos('ordenes:actualizar')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarOrdenDto) {
    return this.ordenes.actualizar(id, dto);
  }

  /* Ruta propia para la transición: es una acción de negocio, no un campo
     más. Así también se le puede exigir un permiso distinto el día que haga
     falta, sin tocar la edición. */
  @Patch(':id/estado') @RequierePermisos('ordenes:actualizar')
  cambiarEstado(@Param('id') id: string, @Body() dto: CambiarEstadoOrdenDto) {
    return this.ordenes.cambiarEstado(id, dto);
  }
}
