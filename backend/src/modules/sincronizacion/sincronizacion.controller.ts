import { Body, Controller, Post } from '@nestjs/common';
import { SincronizacionService } from './sincronizacion.service';
import { LoteEventosDto } from './dto/sincronizacion.dto';
import { RequierePermisos } from '../../common/decorators/permisos.decorator';
import { SinIdempotencia } from '../../common/decorators/sin-idempotencia.decorator';

@Controller('sincronizacion')
export class SincronizacionController {
  constructor(private readonly sincronizacion: SincronizacionService) {}

  /* `@SinIdempotencia` a proposito: la idempotencia del ADR 004 protege la
     PETICION, y aqui la proteccion es POR ELEMENTO —cada uno trae su
     `idCliente`—. Exigir ademas una `Idempotency-Key` de peticion haria que un
     reintento con un elemento nuevo anadido se rechazara entero por «cuerpo
     distinto», que es justo lo que una cola hace todo el rato. */
  @Post('eventos') @SinIdempotencia() @RequierePermisos('eventos:crear')
  drenarEventos(@Body() lote: LoteEventosDto) {
    return this.sincronizacion.drenarEventos(lote);
  }
}
