import { Module } from '@nestjs/common';
import { ConductoresController } from './conductores.controller';
import { ConductoresService } from './conductores.service';

@Module({ controllers: [ConductoresController], providers: [ConductoresService] })
export class ConductoresModule {}
