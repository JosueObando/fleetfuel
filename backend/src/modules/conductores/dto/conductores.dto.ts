import { IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';
import { EsId } from '../../../common/es-id.decorator';

export class CrearConductorDto {
  @IsString() @Length(4, 200) nombreCompleto: string;
  @IsString() @Length(4, 40) documento: string;
  @IsString() @Length(4, 40) licencia: string;
  @IsOptional() @IsString() @Length(1, 20) categoria?: string;
  @IsOptional() @IsDateString() fechaVencimientoLicencia?: string;
  @IsOptional() @IsString() @Length(6, 40) telefono?: string;
  /* §2C · El identificador del canal de chat con el conductor.
     El spec de UX pide `driver.chatChannelId` y un botón en `MapControl`, y NADA
     más: no define mensajes, ni almacenamiento, ni transporte. Se guarda como
     texto OPACO —la aplicación no lo interpreta, sólo se lo entrega al panel—
     porque es el mismo campo tanto si mañana el canal lo sirve WhatsApp,
     Telegram o una mensajería propia. Decidir cuál es lo que falta. */
  @IsOptional() @IsString() @Length(1, 200) canalChat?: string;
  @IsOptional() @IsEmail({}, { message: 'Correo inválido' }) correo?: string;
  @IsOptional() @IsNumber() @Min(0) tarifaBase?: number;
  @IsOptional() @IsNumber() @Min(0) tarifaKm?: number;
  @IsOptional() @IsNumber() @Min(0) tarifaViaje?: number;
  @IsOptional() @IsNumber() @Min(0) tarifaEntrega?: number;
  @IsOptional() @IsString() @Length(4, 200) contactoEmergencia?: string;
  /** Vínculo opcional con el usuario que usará la app del conductor (Fase 2A). */
  @IsOptional() @EsId() usuarioId?: string;
}

export class ActualizarConductorDto extends CrearConductorDto {
  @IsOptional() @IsString() @Length(4, 200) declare nombreCompleto: string;
  @IsOptional() @IsString() @Length(4, 40) declare documento: string;
  @IsOptional() @IsString() @Length(4, 40) declare licencia: string;
  @IsOptional() @IsIn(['disponible', 'en_viaje', 'descanso', 'suspendido']) estado?: string;
}
