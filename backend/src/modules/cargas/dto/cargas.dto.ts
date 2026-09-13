import {
  IsISO8601, IsNumber, IsOptional, IsString, Length, Max, Min,
} from 'class-validator';
import { EsId } from '../../../common/es-id.decorator';

export class RegistrarCargaDto {
  @EsId() compartimentoId: string;
  @EsId() detalleOrdenId: string;

  /** Lo que la terminal dice haber echado. Es el origen de la merma del §10.5. */
  @IsNumber() @Min(0) volumenCargado: number;

  /* §10.4, mismo criterio que en la entrega: media lectura no permite calcular
     nada, así que o vienen las dos o ninguna. */
  @IsOptional() @IsNumber() @Min(0) medidorInicial?: number;
  @IsOptional() @IsNumber() @Min(0) medidorFinal?: number;

  /* «Se registra temperatura y densidad cuando corresponda» (§9, Etapa 5). No
     toda terminal las toma. */
  @IsOptional() @IsNumber() @Min(-50) @Max(150) temperatura?: number;
  @IsOptional() @IsNumber() @Min(0.0001) densidad?: number;

  /* Regla 18 · El sello nace aquí. Obligatorio: una carga sin sello deja a la
     entrega sin nada que verificar, que es el agujero que este módulo cierra. */
  @IsString() @Length(1, 60) numeroSello: string;
  @IsString() @Length(3, 160) operadorTerminal: string;

  /* §9 Etapa 5 · «Se registra geolocalización y hora». */
  @IsNumber() @Min(-90) @Max(90) latitud: number;
  @IsNumber() @Min(-180) @Max(180) longitud: number;

  @IsOptional() @IsISO8601() fechaInicio?: string;
  @IsOptional() @IsISO8601() fechaFin?: string;
  @IsOptional() @IsString() @Length(1, 200) documentoCarga?: string;
  @IsOptional() @IsString() evidenciaFotografica?: string;
  @IsOptional() @IsString() firmaOperador?: string;
}

export class ValidarCargaDto {
  /* Sin motivo no se rechaza, igual que no se aprueba una merma sin razón
     escrita: la §21 pide poder reconstruir POR QUÉ. Al validar es opcional
     porque «cuadra» no necesita explicación; al rechazar el servicio lo exige. */
  @IsOptional() @IsString() @Length(5, 500) motivo?: string;
}
