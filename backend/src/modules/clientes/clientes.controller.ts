import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { CrearClienteDto, ActualizarClienteDto } from './dto/clientes.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('clientes')
export class ClientesController {
  constructor(private readonly clientes: ClientesService) {}

  @Get()      @RequierePermisos('clientes:leer')   listar() { return this.clientes.listar(); }
  @Get(':id') @RequierePermisos('clientes:leer')   obtener(@Param('id') id: string) { return this.clientes.obtener(id); }

  /* El POST hereda la idempotencia del interceptor global (ADR 004): no hace
     falta declararla aquí, y no se puede desactivar por descuido. */
  @Post()     @RequierePermisos('clientes:crear')  crear(@Body() dto: CrearClienteDto) { return this.clientes.crear(dto); }

  @Patch(':id') @RequierePermisos('clientes:actualizar')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarClienteDto) {
    return this.clientes.actualizar(id, dto);
  }

  /* DELETE en HTTP, baja lógica en la base: el verbo describe la intención del
     cliente, no la implementación. */
  @Delete(':id') @RequierePermisos('clientes:desactivar')
  desactivar(@Param('id') id: string) { return this.clientes.desactivar(id); }
}
