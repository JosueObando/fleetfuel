import { Module } from '@nestjs/common';
import { EstacionesController } from './estaciones.controller';
import { EstacionesService } from './estaciones.service';

@Module({ controllers: [EstacionesController], providers: [EstacionesService] })
export class EstacionesModule {}
