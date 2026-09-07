import { Module } from '@nestjs/common';
import { SolicitudesRutaController } from './solicitudes-ruta.controller';
import { SolicitudesRutaService } from './solicitudes-ruta.service';

@Module({
  controllers: [SolicitudesRutaController],
  providers: [SolicitudesRutaService],
})
export class SolicitudesRutaModule {}
