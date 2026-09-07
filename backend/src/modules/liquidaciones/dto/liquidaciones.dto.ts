import { IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class CalcularLiquidacionDto {
  /* Los tres ajustes que pone una persona. Los otros sumandos se derivan del
     viaje y no se pueden teclear: si se pudieran, la liquidación podría decir
     una cosa y el viaje otra, y las dos parecerían correctas por separado. */
  @IsOptional() @IsNumber() @Min(0) viaticos?: number;
  @IsOptional() @IsNumber() @Min(0) bonificaciones?: number;
  @IsOptional() @IsNumber() @Min(0) penalizaciones?: number;

  /* Obligatorio en cuanto alguno de los tres no sea cero, y lo repite una CHECK
     de la base. Un ajuste a mano sin explicación es un número que nadie podrá
     justificar en la siguiente revisión. */
  @IsOptional() @IsString() @Length(5, 500) motivoAjustes?: string;
}

export class AprobarLiquidacionDto {
  @IsOptional() @IsString() @Length(5, 500) observaciones?: string;
}

export class PagarLiquidacionDto {
  /* Sin referencia no hay pago que rastrear: es lo que conecta el importe con
     el movimiento real de dinero. */
  @IsString() @Length(3, 120) referenciaPago: string;
}
