import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { VehiculosService } from './vehiculos.service';
import { CrearVehiculoDto, ActualizarVehiculoDto } from './dto/vehiculos.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('vehiculos')
export class VehiculosController {
  constructor(private readonly vehiculos: VehiculosService) {}

  @Get()      @RequierePermisos('vehiculos:leer') listar() { return this.vehiculos.listar(); }
  @Get(':id') @RequierePermisos('vehiculos:leer') obtener(@Param('id') id: string) { return this.vehiculos.obtener(id); }
  @Post()     @RequierePermisos('vehiculos:crear') crear(@Body() dto: CrearVehiculoDto) { return this.vehiculos.crear(dto); }

  @Patch(':id') @RequierePermisos('vehiculos:actualizar')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarVehiculoDto) { return this.vehiculos.actualizar(id, dto); }

  @Delete(':id') @RequierePermisos('vehiculos:desactivar')
  desactivar(@Param('id') id: string) { return this.vehiculos.desactivar(id); }
}
