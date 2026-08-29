import { IsString, Length } from 'class-validator';

export class RevocarDispositivoDto {
  @IsString() @Length(10, 400, { message: 'Explica el motivo (mínimo 10 caracteres)' })
  motivo: string;
}
