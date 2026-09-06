import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { unaFila } from '../../common/una-fila';
import { CrearVehiculoDto, ActualizarVehiculoDto } from './dto/vehiculos.dto';

const CAMPOS = `vehiculo_id AS id, tipo_vehiculo AS "tipoVehiculo", placa,
                numero_flota AS "numeroFlota", marca, modelo, anio, vin,
                capacidad_combustible_motor AS "capacidadCombustibleMotor",
                odometro_actual AS "odometroActual", estado_operativo AS "estadoOperativo",
                gps_id AS "gpsId", fecha_seguro AS "fechaSeguro", fecha_revision AS "fechaRevision",
                propietario, costo_depreciacion_km AS "costoDepreciacionKm",
                costo_mantenimiento_km AS "costoMantenimientoKm"`;

const COLUMNAS = (d: Partial<ActualizarVehiculoDto>): Record<string, unknown> => ({
  tipo_vehiculo: d.tipoVehiculo, placa: d.placa, numero_flota: d.numeroFlota,
  marca: d.marca, modelo: d.modelo, anio: d.anio, vin: d.vin,
  capacidad_combustible_motor: d.capacidadCombustibleMotor,
  odometro_actual: d.odometroActual, gps_id: d.gpsId,
  fecha_seguro: d.fechaSeguro, fecha_revision: d.fechaRevision,
  propietario: d.propietario, costo_depreciacion_km: d.costoDepreciacionKm,
  costo_mantenimiento_km: d.costoMantenimientoKm, estado_operativo: d.estadoOperativo,
});

@Injectable()
export class VehiculosService {
  listar() {
    return gestor().query(
      `SELECT ${CAMPOS} FROM vehiculos WHERE eliminado_en IS NULL ORDER BY placa`);
  }

  async obtener(id: string) {
    const [f] = await gestor().query(
      `SELECT ${CAMPOS} FROM vehiculos WHERE vehiculo_id = $1 AND eliminado_en IS NULL`, [id]);
    if (!f) throw new NotFoundException('Vehículo no encontrado');
    return f;
  }

  async crear(dto: CrearVehiculoDto) {
    const ctx = contextoActual();
    await this.placaLibre(dto.placa);
    const columnas = COLUMNAS(dto);
    const presentes = Object.entries(columnas).filter(([, v]) => v !== undefined);
    const nombres = ['empresa_id', ...presentes.map(([c]) => c)];
    const marcadores = nombres.map((_, i) => `$${i + 1}`);

    const [creado] = await gestor().query(
      `INSERT INTO vehiculos (${nombres.join(', ')}) VALUES (${marcadores.join(', ')})
       RETURNING ${CAMPOS}`,
      [ctx.empresaId, ...presentes.map(([, v]) => v)]);
    auditar({ entidad: 'vehiculos', entidadId: String(creado.id), valorNuevo: creado });
    return creado;
  }

  async actualizar(id: string, dto: ActualizarVehiculoDto) {
    const antes = await this.obtener(id);
    if (dto.placa && dto.placa !== antes.placa) await this.placaLibre(dto.placa, id);
    const presentes = Object.entries(COLUMNAS(dto)).filter(([, v]) => v !== undefined);
    if (!presentes.length) return antes;
    const despues = unaFila(await gestor().query(
      `UPDATE vehiculos SET ${presentes.map(([c], i) => `${c} = $${i + 2}`).join(', ')},
              actualizado_en = now()
        WHERE vehiculo_id = $1 RETURNING ${CAMPOS}`,
      [id, ...presentes.map(([, v]) => v)]));
    auditar({ entidad: 'vehiculos', entidadId: String(id), valorAnterior: antes, valorNuevo: despues });
    return despues;
  }

  async desactivar(id: string) {
    const antes = await this.obtener(id);
    /* Un vehículo en viaje no se da de baja: dejaría un viaje en curso
       apuntando a una unidad que el sistema considera retirada. */
    if (antes.estadoOperativo === 'en_viaje')
      throw new ConflictException('El vehículo está en viaje; no se puede dar de baja');
    const [cisterna] = await gestor().query(
      `SELECT 1 FROM cisternas WHERE vehiculo_id = $1 AND eliminado_en IS NULL LIMIT 1`, [id]);
    if (cisterna) throw new ConflictException(
      'El vehículo tiene una cisterna asociada; da de baja la cisterna primero');
    const despues = unaFila(await gestor().query(
      `UPDATE vehiculos SET eliminado_en = now(), estado_operativo = 'bloqueado', actualizado_en = now()
        WHERE vehiculo_id = $1 RETURNING ${CAMPOS}`, [id]));
    auditar({ entidad: 'vehiculos', entidadId: String(id), valorAnterior: antes, valorNuevo: despues });
    return despues;
  }

  private async placaLibre(placa: string, exceptoId?: string) {
    const [choque] = await gestor().query(
      `SELECT vehiculo_id FROM vehiculos
        WHERE upper(placa) = upper($1) AND eliminado_en IS NULL
          AND ($2::bigint IS NULL OR vehiculo_id <> $2)`, [placa, exceptoId ?? null]);
    if (choque) throw new ConflictException('Ya existe un vehículo con esa placa');
  }
}
