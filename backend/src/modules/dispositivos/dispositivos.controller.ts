import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { DispositivosService } from './dispositivos.service';
import { RevocarDispositivoDto } from './dto/revocar.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';

@Controller('dispositivos')
export class DispositivosController {
  constructor(private readonly dispositivos: DispositivosService) {}

  @Get()
  @RequierePermisos('dispositivos:leer')
  listar() { return this.dispositivos.listar(); }

  @Patch(':id/revocar')
  @RequierePermisos('dispositivos:revocar')
  revocar(@Param('id') id: string, @Body() dto: RevocarDispositivoDto) {
    return this.dispositivos.revocar(id, dto.motivo);
  }
}
