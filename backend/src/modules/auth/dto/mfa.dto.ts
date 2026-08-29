import { IsString, Matches } from 'class-validator';

export class ConfirmarMfaDto {
  @Matches(/^\d{6}$/, { message: 'El código MFA son 6 dígitos' })
  @IsString()
  codigoTotp: string;
}
