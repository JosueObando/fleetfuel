import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class CrearViajeDto {
  @IsString() @Length(2, 40) codigoViaje: string;
  @IsDateString() fechaProgramada: string;
  @IsOptional() @IsIn(['simple', 'multiple', 'retorno']) tipoViaje?: string;
  @IsOptional() @IsString() cabezalId?: string;
  @IsOptional() @IsString() cisternaId?: string;
  @IsOptional() @IsString() conductorId?: string;
  @IsOptional() @IsString() conductorAuxiliarId?: string;
  @IsOptional() @IsString() origenId?: string;
  @IsOptional() @IsString() terminalCargaId?: string;
  /* Fin previsto: sin él, el viaje ocupa a su cisterna y su conductor de
     forma indefinida y ningún otro viaje posterior podría programarse. */
  @IsOptional() @IsDateString() fechaFin?: string;
  @IsOptional() @IsString() rutaPlanificada?: string;
}

export class ActualizarViajeDto extends CrearViajeDto {
  @IsOptional() @IsString() @Length(2, 40) declare codigoViaje: string;
  @IsOptional() @IsDateString() declare fechaProgramada: string;
  @IsOptional() @IsNumber() @Min(0) odometroInicial?: number;
  @IsOptional() @IsNumber() @Min(0) odometroFinal?: number;
  @IsOptional() @IsNumber() @Min(0) kilometrosGps?: number;
}

export class CambiarEstadoViajeDto {
  @IsString() estado: string;
  @IsOptional() @IsString() @Length(3, 500) motivo?: string;
}

export class AsignarOrdenDto {
  @IsString() ordenId: string;
  @IsInt() @Min(1) secuenciaEntrega: number;
  @IsOptional() @IsDateString() horaEstimada?: string;
}

export class LineaPlanDto {
  @IsString() compartimentoId: string;
  @IsString() detalleOrdenId: string;
  @IsNumber() @Min(0.01) volumenPlanificado: number;
  @IsOptional() @IsString() terminalCarga?: string;
}
