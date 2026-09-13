import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { CrearGeocercaDto } from './dto/alertas.dto';

const CAMPOS = `geocerca_id AS id, nombre, tipo, estacion_id AS "estacionId",
                radio_m AS "radioM", activa,
                ST_Y(ST_Centroid(area::geometry)) AS latitud,
                ST_X(ST_Centroid(area::geometry)) AS longitud,
                round(ST_Area(area)::numeric) AS "areaM2"`;

@Injectable()
export class GeocercasService {
  async listar() {
    return gestor().query(
      `SELECT ${CAMPOS} FROM geocercas ORDER BY tipo, nombre`);
  }

  async obtener(id: string) {
    const [fila] = await gestor().query(
      `SELECT ${CAMPOS} FROM geocercas WHERE geocerca_id = $1`, [id]);
    if (!fila) throw new NotFoundException('Geocerca no encontrada');
    return fila;
  }

  /**
   * Crear una geocerca circular.
   *
   * `ST_Buffer` sobre `geography` trabaja en METROS sobre el elipsoide, asi que
   * el radio es el radio de verdad y no una aproximacion en grados —que mide
   * distinto segun la latitud, y en un pais cerca del ecuador el error pasa
   * desapercibido justo lo suficiente para colarse en produccion—.
   */
  async crear(dto: CrearGeocercaDto) {
    const ctx = contextoActual();
    if (dto.estacionId) {
      const [est] = await gestor().query(
        `SELECT estacion_id FROM estaciones_servicio
          WHERE estacion_id = $1 AND eliminado_en IS NULL`, [dto.estacionId]);
      if (!est) throw new NotFoundException('La estación indicada no existe');
    }

    let creada;
    try {
      [creada] = await gestor().query(
        `INSERT INTO geocercas (empresa_id, nombre, tipo, estacion_id, area, radio_m)
         VALUES ($1,$2,$3,$4,
                 ST_Buffer(ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7)::geography,
                 $7)
         RETURNING geocerca_id`,
        [ctx.empresaId, dto.nombre, dto.tipo, dto.estacionId ?? null,
         dto.latitud, dto.longitud, dto.radioM]);
    } catch (e) {
      if ((e as { constraint?: string }).constraint === 'uq_geocercas_nombre')
        throw new ConflictException('Ya existe una geocerca con ese nombre');
      throw e;
    }

    auditar({ entidad: 'geocercas', entidadId: String(creada.geocerca_id), valorNuevo: { ...dto } });
    return this.obtener(String(creada.geocerca_id));
  }

  /** Las geocercas que CONTIENEN un punto. Es la pregunta que hace todo lo demas. */
  async contienenA(latitud: number, longitud: number) {
    return gestor().query(
      `SELECT ${CAMPOS} FROM geocercas
        WHERE activa
          AND ST_Covers(area, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography)
        ORDER BY ST_Area(area)`, [latitud, longitud]);
  }

  /** Donde esta ahora un viaje, segun su ultima posicion. */
  async dondeEsta(viajeId: string) {
    const [ultima] = await gestor().query(
      `SELECT ST_Y(ubicacion::geometry) AS lat, ST_X(ubicacion::geometry) AS lng,
              fecha_hora AS "fechaHora"
         FROM posiciones_gps WHERE viaje_id = $1
        ORDER BY fecha_hora DESC LIMIT 1`, [viajeId]);
    if (!ultima) return { fechaHora: null, dentroDe: [] };
    return {
      fechaHora: ultima.fechaHora,
      dentroDe: await this.contienenA(Number(ultima.lat), Number(ultima.lng)),
    };
  }
}
