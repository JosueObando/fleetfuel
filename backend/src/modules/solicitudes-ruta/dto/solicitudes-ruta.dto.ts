import { IsIn, IsOptional, IsString, Length } from 'class-validator';

/** Los tres tipos del spec: detour, extra_stop, cancel. */
export const TIPOS_SOLICITUD = ['desvio', 'parada_extra', 'cancelacion'] as const;

export class PedirCambioRutaDto {
  @IsIn(TIPOS_SOLICITUD, {
    message: `El tipo debe ser uno de: ${TIPOS_SOLICITUD.join(', ')}`,
  })
  tipo: string;

  /* Mínimo 5 caracteres, igual que la CHECK de la base. Una solicitud sin razón
     legible es lo que este flujo existe para no permitir: si el motivo puede
     ser un hueco, el registro que queda no prueba nada. */
  @IsString() @Length(5, 1000) motivo: string;
}

export class ResolverCambioRutaDto {
  @IsIn(['aprobada', 'rechazada']) estado: string;

  /* Obligatorio en las dos direcciones. Un «no» sin razón no es una decisión, y
     un «sí» sin razón es peor: es el permiso que nadie tendrá que explicar. */
  @IsString() @Length(5, 1000) motivo: string;
}

/** Sin uso todavía; deja declarada la forma del filtro del panel. */
export class FiltroSolicitudesDto {
  @IsOptional() @IsIn(['pendiente', 'aprobada', 'rechazada']) estado?: string;
}
