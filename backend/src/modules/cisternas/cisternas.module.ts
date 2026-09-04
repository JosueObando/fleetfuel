import { Module } from '@nestjs/common';
import { CisternasController } from './cisternas.controller';
import { CisternasService } from './cisternas.service';

@Module({ controllers: [CisternasController], providers: [CisternasService] })
export class CisternasModule {}
