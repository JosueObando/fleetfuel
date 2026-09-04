import { IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class CrearConductorDto {
  @IsString() @Length(4, 200) nombreCompleto: string;
  @IsString() @Length(4, 40) documento: string;
  @IsString() @Length(4, 40) licencia: string;
  @IsOptional() @IsString() @Length(1, 20) categoria?: string;
  @IsOptional() @IsDateString() fechaVencimientoLicencia?: string;
  @IsOptional() @IsString() @Length(6, 40) telefono?: string;
  @IsOptional() @IsEmail({}, { message: 'Correo inválido' }) correo?: string;
  @IsOptional() @IsNumber() @Min(0) tarifaBase?: number;
  @IsOptional() @IsNumber() @Min(0) tarifaKm?: number;
  @IsOptional() @IsNumber() @Min(0) tarifaViaje?: number;
  @IsOptional() @IsNumber() @Min(0) tarifaEntrega?: number;
  @IsOptional() @IsString() @Length(4, 200) contactoEmergencia?: string;
  /** Vínculo opcional con el usuario que usará la app del conductor (Fase 2A). */
  @IsOptional() @IsString() usuarioId?: string;
}

export class ActualizarConductorDto extends CrearConductorDto {
  @IsOptional() @IsString() @Length(4, 200) declare nombreCompleto: string;
  @IsOptional() @IsString() @Length(4, 40) declare documento: string;
  @IsOptional() @IsString() @Length(4, 40) declare licencia: string;
  @IsOptional() @IsIn(['disponible', 'en_viaje', 'descanso', 'suspendido']) estado?: string;
}
