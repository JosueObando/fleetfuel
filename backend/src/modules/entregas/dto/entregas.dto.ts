import {
  IsInt, IsISO8601, IsIn, IsNumber, IsOptional, IsString, Length, Max, Min,
} from 'class-validator';
import { EsId } from '../../../common/es-id.decorator';

export class RegistrarEntregaDto {
  @EsId() detalleOrdenId: string;
  @EsId() compartimentoId: string;

  /** Lo que la estación ACEPTA. Es el número que manda en la conciliación. */
  @IsNumber() @Min(0) volumenRecibido: number;

  /* §10.4: el volumen medido sale de la resta de los medidores. Son opcionales
     porque no toda estación tiene medidor propio, pero si viene uno tiene que
     venir el otro: media lectura no permite calcular nada. */
  @IsOptional() @IsNumber() @Min(0) medidorInicial?: number;
  @IsOptional() @IsNumber() @Min(0) medidorFinal?: number;

  @IsString() @Length(3, 160) receptorNombre: string;
  @IsOptional() @IsString() @Length(3, 40) receptorDocumento?: string;
  @IsOptional() @IsString() firmaDigital?: string;

  /* Regla 8: «Toda entrega debe incluir geolocalización». No son opcionales, y
     por eso tampoco lo son las columnas. */
  @IsNumber() @Min(-90) @Max(90) latitud: number;
  @IsNumber() @Min(-180) @Max(180) longitud: number;

  @IsOptional() @IsString() @Length(1, 60) selloRecibido?: string;
  @IsOptional() @IsIn(['intacto', 'roto', 'inconsistente']) estadoSello?: string;

  @IsOptional() @IsISO8601() fechaLlegada?: string;
  @IsOptional() @IsString() @Length(1, 200) documentoEntrega?: string;
  @IsOptional() @IsString() observaciones?: string;
}

export class AprobarEntregaDto {
  /* Sin motivo no se aprueba. Una diferencia de volumen perdonada sin razón
     escrita es indistinguible de una que nadie miró, y la §21 pide poder
     reconstruir POR QUÉ se aceptó. */
  @IsString() @Length(5, 500) motivo: string;
}

export class RechazarEntregaDto {
  @IsString() @Length(5, 500) motivo: string;
}

/** Sin uso todavía; declarado para que el filtro de listado tenga forma. */
export class FiltroEntregasDto {
  @IsOptional() @IsInt() viajeId?: number;
}
