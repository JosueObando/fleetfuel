import { IsIn, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';
import { EsId } from '../../../common/es-id.decorator';

export class CrearEstacionDto {
  @EsId() clienteId: string;
  @IsString() @Length(2, 160) nombre: string;
  @IsOptional() @IsString() @Length(1, 60) codigoExterno?: string;
  @IsOptional() @IsString() @Length(2, 80) provincia?: string;
  @IsOptional() @IsString() @Length(2, 80) distrito?: string;
  @IsOptional() @IsString() @Length(2, 80) corregimiento?: string;
  @IsOptional() @IsString() @Length(4, 300) direccion?: string;
  // Latitud y longitud viajan sueltas en la API —es lo natural para un
  // cliente— y se combinan en un `geography(Point)` al escribir.
  @IsOptional() @IsLatitude() latitud?: number;
  @IsOptional() @IsLongitude() longitud?: number;
  @IsOptional() @IsString() @Length(2, 120) horarioRecepcion?: string;
  @IsOptional() @IsString() @Length(2, 160) contactoRecepcion?: string;
  @IsOptional() @IsNumber() @Min(0.01) capacidadTotal?: number;
}

export class ActualizarEstacionDto extends CrearEstacionDto {
  @IsOptional() @IsString() declare clienteId: string;
  @IsOptional() @IsString() @Length(2, 160) declare nombre: string;
  @IsOptional() @IsIn(['activa', 'inactiva']) estado?: string;
}
