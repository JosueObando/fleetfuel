import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SaludService } from './salud.service';
import { Publico } from '../../common/decorators/publico.decorator';

@Controller('salud')
export class SaludController {
  constructor(private readonly salud: SaludService) {}

  /**
   * Pública y sin autenticar: un chequeo de salud que exige un token no sirve
   * para lo que existe —que un balanceador o un monitor sepan si este proceso
   * puede recibir tráfico— porque pedir el token ya requiere que la aplicación
   * y la base estén sanas.
   *
   * Devuelve 503 cuando una dependencia está caída, no 200 con un campo que
   * diga que algo va mal: los monitores miran el código de estado, y un 200
   * significa «sano» aunque el cuerpo diga lo contrario.
   */
  @Publico()
  @Get()
  async revisar(@Res({ passthrough: true }) res: Response) {
    const salud = await this.salud.revisar();
    res.status(salud.estado === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return salud;
  }
}
