import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsISO8601, IsNumber, IsOptional,
  Max, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EsId } from '../../../common/es-id.decorator';

export class PosicionDto {
  @IsISO8601() fechaHora: string;
  @IsNumber() @Min(-90) @Max(90) latitud: number;
  @IsNumber() @Min(-180) @Max(180) longitud: number;

  @IsOptional() @IsNumber() @Min(0) velocidad?: number;
  /* 0 a 359,99: 360 es 0 y admitir los dos permite que dos posiciones
     identicas no lo parezcan. */
  @IsOptional() @IsNumber() @Min(0) @Max(359.99) rumbo?: number;
  @IsOptional() @IsNumber() altitud?: number;
  @IsOptional() @IsNumber() @Min(0) precisionM?: number;
  @IsOptional() @IsIn(['gps', 'movil', 'sensor', 'api']) origen?: string;
  @IsOptional() @EsId() dispositivoId?: string;
}

export class LotePosicionesDto {
  @EsId() vehiculoId: string;
  @IsOptional() @EsId() viajeId?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Un lote vacio no es telemetria' })
  /* Un vehiculo a 5 s de cadencia acumula 720 posiciones por hora. El tope de
     500 cubre de sobra una reconexion tras un tunel largo sin que una sola
     peticion tenga que insertar un dia entero. */
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PosicionDto)
  posiciones: PosicionDto[];
}
