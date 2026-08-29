import { ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class CrearRolDto {
  @IsString() @Length(3, 80) nombre: string;
  @IsOptional() @IsString() @Length(3, 240) descripcion?: string;
  @IsOptional() @IsBoolean() exigeMfa?: boolean;
}

export class DefinirPermisosDto {
  @IsArray() @ArrayUnique() @IsString({ each: true }) permisos: string[];
}
