import { IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

/** Las cinco del §7.17. */
export const CATEGORIAS = ['peaje', 'viatico', 'reparacion', 'estacionamiento', 'otro'] as const;

export class RegistrarGastoDto {
  @IsIn(CATEGORIAS, { message: `La categoría debe ser una de: ${CATEGORIAS.join(', ')}` })
  categoria: string;

  @IsString() @Length(3, 400) descripcion: string;

  /* `Min(0.01)` y no `Min(0)`: un gasto de cero no es un gasto. La base lo
     repite con `monto > 0` porque esta comprobación se salta llamando al
     servicio, y la de allí no. */
  @IsNumber() @Min(0.01) monto: number;

  @IsOptional() @IsISO8601() fecha?: string;
  @IsOptional() @IsString() @Length(1, 200) comprobante?: string;

  @IsIn(['empresa', 'conductor']) pagadoPor: string;

  /* Sólo tiene sentido si pagó el conductor, y esa relación la vigila una CHECK
     de la base: aquí no se puede comprobar sin mirar la otra columna. */
  @IsOptional() @IsBoolean() reembolsable?: boolean;
}

export class ResolverGastoDto {
  @IsIn(['aprobado', 'rechazado']) estado: string;
  @IsString() @Length(5, 500) motivo: string;
}
