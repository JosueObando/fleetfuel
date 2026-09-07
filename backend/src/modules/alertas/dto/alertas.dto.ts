import { IsIn, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { EsId } from '../../../common/es-id.decorator';

export class CrearGeocercaDto {
  @IsString() @Length(2, 160) nombre: string;
  @IsIn(['estacion', 'terminal', 'taller', 'zona_prohibida', 'zona_permitida']) tipo: string;
  @IsOptional() @EsId() estacionId?: string;

  /* Centro y radio, que es como se define una geocerca en la practica. El
     poligono lo construye el servicio: guardar centro+radio obligaria a cada
     consulta a decidir si compara contra un circulo o contra un poligono, y esa
     bifurcacion acaba escrita distinto en cada sitio. */
  @IsNumber() @Min(-90) @Max(90) latitud: number;
  @IsNumber() @Min(-180) @Max(180) longitud: number;
  /* Minimo 20 m: por debajo de eso la precision tipica de un GPS de movil
     —entre 5 y 15 m— haria que el camion entrara y saliera solo, y cada
     parpadeo seria una alerta. */
  @IsNumber() @Min(20) @Max(50000) radioM: number;
}

export class ResolverAlertaDto {
  @IsString() @Length(5, 500) motivo: string;
}
