import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

const AHORA = new Date().getFullYear();

export class CrearVehiculoDto {
  @IsIn(['cabezal', 'cisterna', 'integrada']) tipoVehiculo: string;
  @IsString() @Length(4, 20) placa: string;
  @IsOptional() @IsString() @Length(1, 40) numeroFlota?: string;
  @IsOptional() @IsString() @Length(2, 80) marca?: string;
  @IsOptional() @IsString() @Length(1, 80) modelo?: string;
  // El tope es el año próximo, no el actual: los concesionarios matriculan
  // modelos del año siguiente antes de que termine el corriente.
  @IsOptional() @IsInt() @Min(1950) @Max(AHORA + 1) anio?: number;
  @IsOptional() @IsString() @Length(11, 40) vin?: string;
  @IsOptional() @IsNumber() @Min(0) capacidadCombustibleMotor?: number;
  @IsOptional() @IsNumber() @Min(0) odometroActual?: number;
  @IsOptional() @IsString() @Length(2, 80) gpsId?: string;
  @IsOptional() @IsDateString() fechaSeguro?: string;
  @IsOptional() @IsDateString() fechaRevision?: string;
  @IsOptional() @IsIn(['propio', 'tercero']) propietario?: string;
  @IsOptional() @IsNumber() @Min(0) costoDepreciacionKm?: number;
  @IsOptional() @IsNumber() @Min(0) costoMantenimientoKm?: number;
}

export class ActualizarVehiculoDto extends CrearVehiculoDto {
  @IsOptional() @IsIn(['cabezal', 'cisterna', 'integrada']) declare tipoVehiculo: string;
  @IsOptional() @IsString() @Length(4, 20) declare placa: string;
  @IsOptional() @IsIn(['disponible', 'en_viaje', 'mantenimiento', 'bloqueado']) estadoOperativo?: string;
}
