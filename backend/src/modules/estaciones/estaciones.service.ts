import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { CrearEstacionDto, ActualizarEstacionDto } from './dto/estaciones.dto';

/* La ubicación sale descompuesta otra vez en latitud/longitud: el cliente no
   debería tener que entender WKB ni GeoJSON para pintar un marcador. */
const CAMPOS = `estacion_id AS id, cliente_id AS "clienteId", nombre,
                codigo_externo AS "codigoExterno", provincia, distrito, corregimiento,
                direccion, ST_Y(ubicacion::geometry) AS latitud, ST_X(ubicacion::geometry) AS longitud,
                horario_recepcion AS "horarioRecepcion", contacto_recepcion AS "contactoRecepcion",
                capacidad_total AS "capacidadTotal", estado`;

@Injectable()
export class EstacionesService {
  listar() {
    return gestor().query(
      `SELECT ${CAMPOS} FROM estaciones_servicio WHERE eliminado_en IS NULL ORDER BY nombre`);
  }

  async obtener(id: string) {
    const [f] = await gestor().query(
      `SELECT ${CAMPOS} FROM estaciones_servicio WHERE estacion_id = $1 AND eliminado_en IS NULL`, [id]);
    if (!f) throw new NotFoundException('Estación no encontrada');
    return f;
  }

  async crear(dto: CrearEstacionDto) {
    const ctx = contextoActual();
    await this.clienteExiste(dto.clienteId);
    this.coordenadasCompletas(dto.latitud, dto.longitud);
    await this.codigoLibre(dto.codigoExterno);

    const [creado] = await gestor().query(
      `INSERT INTO estaciones_servicio
         (empresa_id, cliente_id, nombre, codigo_externo, provincia, distrito, corregimiento,
          direccion, ubicacion, horario_recepcion, contacto_recepcion, capacidad_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
               CASE WHEN $9::float8 IS NULL THEN NULL
                    ELSE ST_SetSRID(ST_MakePoint($10::float8, $9::float8), 4326)::geography END,
               $11,$12,$13)
       RETURNING ${CAMPOS}`,
      [ctx.empresaId, dto.clienteId, dto.nombre, dto.codigoExterno ?? null,
       dto.provincia ?? null, dto.distrito ?? null, dto.corregimiento ?? null,
       dto.direccion ?? null, dto.latitud ?? null, dto.longitud ?? null,
       dto.horarioRecepcion ?? null, dto.contactoRecepcion ?? null, dto.capacidadTotal ?? null]);
    auditar({ entidad: 'estaciones_servicio', entidadId: String(creado.id), valorNuevo: creado });
    return creado;
  }

  async actualizar(id: string, dto: ActualizarEstacionDto) {
    const antes = await this.obtener(id);
    if (dto.clienteId) await this.clienteExiste(dto.clienteId);
    if (dto.codigoExterno && dto.codigoExterno !== antes.codigoExterno)
      await this.codigoLibre(dto.codigoExterno, id);

    const columnas: Record<string, unknown> = {
      cliente_id: dto.clienteId, nombre: dto.nombre, codigo_externo: dto.codigoExterno,
      provincia: dto.provincia, distrito: dto.distrito, corregimiento: dto.corregimiento,
      direccion: dto.direccion, horario_recepcion: dto.horarioRecepcion,
      contacto_recepcion: dto.contactoRecepcion, capacidad_total: dto.capacidadTotal,
      estado: dto.estado,
    };
    const presentes = Object.entries(columnas).filter(([, v]) => v !== undefined);
    const asignaciones = presentes.map(([c], i) => `${c} = $${i + 2}`);
    const valores: unknown[] = presentes.map(([, v]) => v);

    /* La ubicación se toca solo si vienen AMBAS coordenadas: una sola no
       define un punto, y aceptarla a medias dejaría el mapa mintiendo. */
    if (dto.latitud !== undefined || dto.longitud !== undefined) {
      this.coordenadasCompletas(dto.latitud, dto.longitud, true);
      asignaciones.push(
        `ubicacion = ST_SetSRID(ST_MakePoint($${valores.length + 3}::float8, $${valores.length + 2}::float8), 4326)::geography`);
      valores.push(dto.latitud, dto.longitud);
    }
    if (!asignaciones.length) return antes;

    const [despues] = await gestor().query(
      `UPDATE estaciones_servicio SET ${asignaciones.join(', ')}, actualizado_en = now()
        WHERE estacion_id = $1 RETURNING ${CAMPOS}`, [id, ...valores]);
    auditar({ entidad: 'estaciones_servicio', entidadId: String(id), valorAnterior: antes, valorNuevo: despues });
    return despues;
  }

  async desactivar(id: string) {
    const antes = await this.obtener(id);
    const [despues] = await gestor().query(
      `UPDATE estaciones_servicio SET eliminado_en = now(), estado = 'inactiva', actualizado_en = now()
        WHERE estacion_id = $1 RETURNING ${CAMPOS}`, [id]);
    auditar({ entidad: 'estaciones_servicio', entidadId: String(id), valorAnterior: antes, valorNuevo: despues });
    return despues;
  }

  private coordenadasCompletas(lat?: number, lon?: number, ambasObligatorias = false) {
    const faltaUna = (lat === undefined) !== (lon === undefined);
    if (faltaUna || (ambasObligatorias && (lat === undefined || lon === undefined)))
      throw new BadRequestException('Latitud y longitud deben ir juntas');
  }

  /* La clave foránea ya lo impide, pero devolvería un 500 opaco. Esto convierte
     el error en un 400 que dice qué está mal. La RLS garantiza además que solo
     encuentre clientes de la misma empresa. */
  private async clienteExiste(clienteId: string) {
    const [c] = await gestor().query(
      `SELECT 1 FROM clientes WHERE cliente_id = $1 AND eliminado_en IS NULL`, [clienteId]);
    if (!c) throw new BadRequestException('El cliente indicado no existe');
  }

  private async codigoLibre(codigo?: string, exceptoId?: string) {
    if (!codigo) return;
    const [choque] = await gestor().query(
      `SELECT estacion_id FROM estaciones_servicio
        WHERE codigo_externo = $1 AND eliminado_en IS NULL AND ($2::bigint IS NULL OR estacion_id <> $2)`,
      [codigo, exceptoId ?? null]);
    if (choque) throw new ConflictException('Ya existe una estación con ese código externo');
  }
}
