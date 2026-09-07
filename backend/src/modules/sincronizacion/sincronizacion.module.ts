import { Module } from '@nestjs/common';
import { SincronizacionController } from './sincronizacion.controller';
import { SincronizacionService } from './sincronizacion.service';
import { EventosService } from '../eventos/eventos.service';

@Module({
  controllers: [SincronizacionController],
  providers: [SincronizacionService, EventosService],
})
export class SincronizacionModule {}
