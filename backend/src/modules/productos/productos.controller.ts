import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ProductosService } from './productos.service';
import { CrearProductoDto, ActualizarProductoDto } from './dto/productos.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('productos')
export class ProductosController {
  constructor(private readonly productos: ProductosService) {}

  @Get()      @RequierePermisos('productos:leer') listar() { return this.productos.listar(); }
  @Get(':id') @RequierePermisos('productos:leer') obtener(@Param('id') id: string) { return this.productos.obtener(id); }
  @Post()     @RequierePermisos('productos:crear') crear(@Body() dto: CrearProductoDto) { return this.productos.crear(dto); }

  @Patch(':id') @RequierePermisos('productos:actualizar')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarProductoDto) { return this.productos.actualizar(id, dto); }

  @Delete(':id') @RequierePermisos('productos:desactivar')
  desactivar(@Param('id') id: string) { return this.productos.desactivar(id); }
}
