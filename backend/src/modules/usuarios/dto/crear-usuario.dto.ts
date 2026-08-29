import { ArrayUnique, IsArray, IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CrearUsuarioDto {
  @IsString() @Length(3, 160) nombre: string;

  @IsEmail({}, { message: 'Correo inválido' }) correo: string;

  // El mínimo de 12 no es capricho: estos usuarios administran un sistema cuyo
  // riesgo principal es el fraude interno (§7), y las claves cortas se comparten.
  @IsString()
  @Length(12, 120, { message: 'La clave debe tener al menos 12 caracteres' })
  @Matches(/[A-Z]/, { message: 'La clave debe incluir una mayúscula' })
  @Matches(/[a-z]/, { message: 'La clave debe incluir una minúscula' })
  @Matches(/\d/, { message: 'La clave debe incluir un dígito' })
  clave: string;

  @IsOptional() @IsString() @Length(6, 40) telefono?: string;

  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) roles?: string[];
}
