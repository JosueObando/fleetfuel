import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CrearProductoDto {
  @IsString() @Length(1, 40) codigo: string;
  @IsString() @Length(2, 120) nombre: string;
  @IsOptional() @IsIn(['litros', 'galones']) unidadMedida?: string;
  @IsOptional() @IsNumber() @Min(0.0001) densidadReferencia?: number;
  // 0-100 porque es un porcentaje. Un valor absurdo aquí no explota: se
  // propaga en silencio hasta las liquidaciones de conductor.
  @IsOptional() @IsNumber() @Min(0) @Max(100) toleranciaMerma?: number;
  @IsOptional() @IsBoolean() requiereTemperatura?: boolean;
  @IsOptional() @IsString() @Length(3, 20) colorIdentificacion?: string;
}

export class ActualizarProductoDto {
  @IsOptional() @IsString() @Length(1, 40) codigo?: string;
  @IsOptional() @IsString() @Length(2, 120) nombre?: string;
  @IsOptional() @IsIn(['litros', 'galones']) unidadMedida?: string;
  @IsOptional() @IsNumber() @Min(0.0001) densidadReferencia?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) toleranciaMerma?: number;
  @IsOptional() @IsBoolean() requiereTemperatura?: boolean;
  @IsOptional() @IsString() @Length(3, 20) colorIdentificacion?: string;
  @IsOptional() @IsIn(['activo', 'inactivo']) estado?: string;
}
