import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RegistrarEventoDto } from '../../eventos/dto/eventos.dto';
import { EsId } from '../../../common/es-id.decorator';

export class ElementoColaDto extends RegistrarEventoDto {
  /* Lo genera el DISPOSITIVO, y es lo que hace idempotente el reintento. Un id
     del servidor no sirve: no existe todavia cuando la app necesita recordar
     que ya mando esa fila. */
  @IsUUID() idCliente: string;

  @EsId() viajeId: string;
}

export class LoteEventosDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Un lote vacio no es una sincronizacion' })
  /* El tope no es arbitrario: todo el lote corre dentro de UNA transaccion de
     peticion, y una transaccion larga bloquea filas y acumula savepoints. Cien
     elementos cubren de sobra una jornada sin cobertura; lo que pase de ahi son
     varias tandas, que ademas confirman antes y dejan la cola mas corta. */
  @ArrayMaxSize(100, { message: 'El lote admite como maximo 100 elementos por tanda' })
  @ValidateNested({ each: true })
  @Type(() => ElementoColaDto)
  eventos: ElementoColaDto[];
}
