import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CrearClienteDto {
  @IsString() @Length(2, 160) nombre: string;
  @IsOptional() @IsString() @Length(2, 200) razonSocial?: string;
  @IsOptional() @IsString() @Length(3, 40) ruc?: string;
  @IsOptional() @IsString() @Length(2, 160) contacto?: string;
  @IsOptional() @IsString() @Length(6, 40) telefono?: string;
  @IsOptional() @IsEmail({}, { message: 'Correo inválido' }) correo?: string;
}

/* Todos los campos opcionales: un PATCH modifica lo que le mandes y deja el
   resto intacto. Si fueran obligatorios, cambiar un teléfono exigiría
   reenviar el registro entero y cualquier campo omitido se borraría. */
export class ActualizarClienteDto {
  @IsOptional() @IsString() @Length(2, 160) nombre?: string;
  @IsOptional() @IsString() @Length(2, 200) razonSocial?: string;
  @IsOptional() @IsString() @Length(3, 40) ruc?: string;
  @IsOptional() @IsString() @Length(2, 160) contacto?: string;
  @IsOptional() @IsString() @Length(6, 40) telefono?: string;
  @IsOptional() @IsEmail({}, { message: 'Correo inválido' }) correo?: string;
  @IsOptional() @IsIn(['activo', 'inactivo']) estado?: string;
}
