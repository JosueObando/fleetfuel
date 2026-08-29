import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Correo inválido' })
  correo: string;

  @IsString()
  @Length(8, 120, { message: 'La clave debe tener entre 8 y 120 caracteres' })
  clave: string;

  /** Código TOTP de 6 dígitos. Obligatorio si el usuario tiene MFA activo. */
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'El código MFA son 6 dígitos' })
  codigoTotp?: string;

  /** Identificador estable del equipo, para poder revocarlo después (§7). */
  @IsOptional()
  @IsString()
  @Length(8, 120)
  dispositivo?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  dispositivoNombre?: string;
}
