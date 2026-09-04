import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CisternasService } from './cisternas.service';
import { CrearCisternaDto, ActualizarCisternaDto } from './dto/cisternas.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('cisternas')
export class CisternasController {
  constructor(private readonly cisternas: CisternasService) {}

  @Get()      @RequierePermisos('cisternas:leer') listar() { return this.cisternas.listar(); }
  @Get(':id') @RequierePermisos('cisternas:leer') obtener(@Param('id') id: string) { return this.cisternas.obtener(id); }

  @Get(':id/compartimentos') @RequierePermisos('cisternas:leer')
  compartimentos(@Param('id') id: string) { return this.cisternas.compartimentosDe(id); }

  @Post() @RequierePermisos('cisternas:crear') crear(@Body() dto: CrearCisternaDto) { return this.cisternas.crear(dto); }

  @Patch(':id') @RequierePermisos('cisternas:actualizar')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarCisternaDto) { return this.cisternas.actualizar(id, dto); }

  @Delete(':id') @RequierePermisos('cisternas:desactivar')
  desactivar(@Param('id') id: string) { return this.cisternas.desactivar(id); }
}
