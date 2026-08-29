import { IsString, Length } from 'class-validator';

export class RefrescarDto {
  @IsString()
  @Length(20, 2000)
  refreshToken: string;
}
