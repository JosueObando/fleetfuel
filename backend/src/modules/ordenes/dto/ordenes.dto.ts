import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional,
  IsString, Length, Max, Min, ValidateNested,
} from 'class-validator';

export class DetalleOrdenDto {
  @IsString() productoId: string;
  @IsNumber() @Min(0.01) volumenSolicitado: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) tolerancia?: number;
}

export class CrearOrdenDto {
  @IsString() clienteId: string;
  @IsString() estacionId: string;
  @IsOptional() @IsString() @Length(1, 60) numeroOrdenExterna?: string;
  @IsOptional() @IsDateString() fechaRequerida?: string;
  @IsOptional() @IsDateString() ventanaInicio?: string;
  @IsOptional() @IsDateString() ventanaFin?: string;
  @IsOptional() @IsIn(['baja', 'normal', 'alta', 'urgente']) prioridad?: string;
  @IsOptional() @IsIn(['manual', 'api', 'excel', 'correo']) fuente?: string;
  @IsOptional() @IsString() observaciones?: string;

  /* Una orden sin líneas no pide nada. Se crean con la orden y en la misma
     transacción: una orden a medio detallar parece planificable y no lo es. */
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DetalleOrdenDto)
  detalles: DetalleOrdenDto[];
}

export class ActualizarOrdenDto {
  @IsOptional() @IsDateString() fechaRequerida?: string;
  @IsOptional() @IsDateString() ventanaInicio?: string;
  @IsOptional() @IsDateString() ventanaFin?: string;
  @IsOptional() @IsIn(['baja', 'normal', 'alta', 'urgente']) prioridad?: string;
  @IsOptional() @IsString() observaciones?: string;
}

export class CambiarEstadoOrdenDto {
  @IsIn(['validada', 'planificada', 'asignada', 'en_carga', 'cargada', 'en_transito',
         'entrega_parcial', 'entregada', 'conciliada', 'cerrada',
         'rechazada', 'cancelada', 'suspendida', 'con_incidencia'])
  estado: string;
  @IsOptional() @IsString() @Length(3, 500) motivo?: string;
}
