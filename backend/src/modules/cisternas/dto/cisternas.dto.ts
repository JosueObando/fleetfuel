import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber,
  IsOptional, IsString, Length, Max, Min, ValidateNested,
} from 'class-validator';

export class CompartimentoDto {
  @IsInt() @Min(1) @Max(12) numero: number;
  @IsNumber() @Min(0.01) capacidadNominal: number;
  @IsNumber() @Min(0.01) capacidadCalibrada: number;
  @IsOptional() @IsString() productoPermitido?: string;
  @IsOptional() @IsDateString() fechaUltimaLimpieza?: string;
  @IsOptional() @IsString() @Length(0, 2000) observaciones?: string;
}

export class CrearCisternaDto {
  @IsString() vehiculoId: string;
  @IsNumber() @Min(0.01) capacidadTotal: number;
  @IsOptional() @IsString() @Length(2, 120) certificadoCalibracion?: string;
  @IsOptional() @IsDateString() fechaCalibracion?: string;
  @IsOptional() @IsDateString() fechaProximaCalibracion?: string;
  @IsOptional() @IsString() @Length(2, 60) material?: string;
  @IsOptional() @IsString() productoAnterior?: string;

  /* Los compartimentos se crean CON la cisterna, no después. Una cisterna sin
     compartimentos no puede cargarse: existiría en un estado que el negocio
     no admite, y el plan de carga de 1B se toparía con ella. */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12)
  @ValidateNested({ each: true }) @Type(() => CompartimentoDto)
  compartimentos: CompartimentoDto[];
}

export class ActualizarCisternaDto {
  @IsOptional() @IsNumber() @Min(0.01) capacidadTotal?: number;
  @IsOptional() @IsString() @Length(2, 120) certificadoCalibracion?: string;
  @IsOptional() @IsDateString() fechaCalibracion?: string;
  @IsOptional() @IsDateString() fechaProximaCalibracion?: string;
  @IsOptional() @IsString() @Length(2, 60) material?: string;
  @IsOptional() @IsIn(['limpia', 'pendiente', 'bloqueada']) estadoLimpieza?: string;
  @IsOptional() @IsString() productoAnterior?: string;
  @IsOptional() @IsIn(['disponible', 'cargada', 'en_viaje', 'mantenimiento']) estado?: string;
}
