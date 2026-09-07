import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { EsId } from '../../../common/es-id.decorator';

/** Los seis del §7.15. La corrección la crea el propio servicio, no el cliente. */
export const TIPOS_EVENTO = [
  'salida', 'llegada', 'carga', 'parada', 'entrega', 'incidente',
] as const;
export const ORIGENES = ['gps', 'movil', 'web', 'sensor', 'api'] as const;

export class RegistrarEventoDto {
  @IsIn(TIPOS_EVENTO, { message: `El tipo debe ser uno de: ${TIPOS_EVENTO.join(', ')}` })
  tipoEvento: string;

  @IsIn(ORIGENES) origenDato: string;

  /* La hora la puede traer el cliente: la app del conductor (2A) registra sin
     cobertura y sincroniza despues, asi que el momento del evento y el de su
     llegada al servidor son distintos por diseno. Si no viene, es ahora. */
  @IsOptional() @IsISO8601() fechaHora?: string;

  /* La geolocalizacion va en pareja o no va: media coordenada no ubica nada. */
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitud?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitud?: number;

  @IsOptional() @IsNumber() @Min(0) velocidad?: number;
  @IsOptional() @IsNumber() @Min(0) odometro?: number;
  @IsOptional() @EsId() dispositivoId?: string;
  @IsOptional() @IsString() @Length(1, 2000) observacion?: string;
  @IsOptional() @IsString() @Length(1, 300) evidencia?: string;
}

export class AnularEventoDto {
  /* El §7.15 pide que la anulacion sea «auditada», y una sin razon escrita no
     lo es: dice que algo se retiro y no por que. */
  @IsString() @Length(5, 2000) motivo: string;
}
