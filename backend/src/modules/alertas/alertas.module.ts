import { Module } from '@nestjs/common';
import { AlertasController, GeocercasController } from './alertas.controller';
import { AlertasService } from './alertas.service';
import { GeocercasService } from './geocercas.service';

@Module({
  controllers: [AlertasController, GeocercasController],
  providers: [AlertasService, GeocercasService],
})
export class AlertasModule {}
