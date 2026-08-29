import { IsString, Length } from 'class-validator';

export class SuspenderUsuarioDto {
  /** §21 pide el motivo del cambio, no sólo el cambio. */
  @IsString() @Length(10, 400, { message: 'Explica el motivo (mínimo 10 caracteres)' })
  motivo: string;
}
