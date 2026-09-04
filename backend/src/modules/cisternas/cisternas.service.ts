import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { CrearCisternaDto, ActualizarCisternaDto, CompartimentoDto } from './dto/cisternas.dto';

const CAMPOS = `c.cisterna_id AS id, c.vehiculo_id AS "vehiculoId", v.placa,
                c.capacidad_total AS "capacidadTotal",
                c.cantidad_compartimentos AS "cantidadCompartimentos",
                c.certificado_calibracion AS "certificadoCalibracion",
                c.fecha_calibracion AS "fechaCalibracion",
                c.fecha_proxima_calibracion AS "fechaProximaCalibracion",
                c.material, c.estado_limpieza AS "estadoLimpieza",
                c.producto_anterior AS "productoAnterior", c.estado,
                (c.fecha_proxima_calibracion IS NOT NULL
                 AND c.fecha_proxima_calibracion < current_date) AS "calibracionVencida"`;

@Injectable()
export class CisternasService {
  listar() {
    return gestor().query(
      `SELECT ${CAMPOS} FROM cisternas c
         JOIN vehiculos v ON v.vehiculo_id = c.vehiculo_id
        WHERE c.eliminado_en IS NULL ORDER BY v.placa`);
  }

  async obtener(id: string) {
    const [cisterna] = await gestor().query(
      `SELECT ${CAMPOS} FROM cisternas c
         JOIN vehiculos v ON v.vehiculo_id = c.vehiculo_id
        WHERE c.cisterna_id = $1 AND c.eliminado_en IS NULL`, [id]);
    if (!cisterna) throw new NotFoundException('Cisterna no encontrada');
    cisterna.compartimentos = await this.compartimentosDe(id);
    return cisterna;
  }

  compartimentosDe(cisternaId: string) {
    return gestor().query(
      `SELECT compartimento_id AS id, numero, capacidad_nominal AS "capacidadNominal",
              capacidad_calibrada AS "capacidadCalibrada",
              producto_permitido AS "productoPermitido", estado,
              fecha_ultima_limpieza AS "fechaUltimaLimpieza", observaciones
         FROM compartimentos_cisterna WHERE cisterna_id = $1 ORDER BY numero`, [cisternaId]);
  }

  async crear(dto: CrearCisternaDto) {
    const ctx = contextoActual();
    await this.vehiculoDisponible(dto.vehiculoId);
    this.validarCompartimentos(dto.compartimentos, dto.capacidadTotal);

    const [creada] = await gestor().query(
      `INSERT INTO cisternas
         (empresa_id, vehiculo_id, capacidad_total, cantidad_compartimentos,
          certificado_calibracion, fecha_calibracion, fecha_proxima_calibracion,
          material, producto_anterior)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING cisterna_id AS id`,
      [ctx.empresaId, dto.vehiculoId, dto.capacidadTotal, dto.compartimentos.length,
       dto.certificadoCalibracion ?? null, dto.fechaCalibracion ?? null,
       dto.fechaProximaCalibracion ?? null, dto.material ?? null, dto.productoAnterior ?? null]);

    /* Todo en la misma transacción de la petición: si un compartimento falla,
       la cisterna tampoco se guarda. Una cisterna a medio compartimentar es
       peor que ninguna, porque parece utilizable. */
    for (const c of dto.compartimentos) {
      await gestor().query(
        `INSERT INTO compartimentos_cisterna
           (empresa_id, cisterna_id, numero, capacidad_nominal, capacidad_calibrada,
            producto_permitido, fecha_ultima_limpieza, observaciones)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [ctx.empresaId, creada.id, c.numero, c.capacidadNominal, c.capacidadCalibrada,
         c.productoPermitido ?? null, c.fechaUltimaLimpieza ?? null, c.observaciones ?? null]);
    }

    const completa = await this.obtener(creada.id);
    auditar({ entidad: 'cisternas', entidadId: String(creada.id), valorNuevo: completa });
    return completa;
  }

  async actualizar(id: string, dto: ActualizarCisternaDto) {
    const antes = await this.obtener(id);
    if (dto.capacidadTotal !== undefined) {
      const suma = antes.compartimentos.reduce(
        (t: number, c: { capacidadNominal: string }) => t + Number(c.capacidadNominal), 0);
      if (suma > dto.capacidadTotal) throw new BadRequestException(
        `Los compartimentos suman ${suma}, más que la capacidad total propuesta (${dto.capacidadTotal})`);
    }
    const columnas: Record<string, unknown> = {
      capacidad_total: dto.capacidadTotal, certificado_calibracion: dto.certificadoCalibracion,
      fecha_calibracion: dto.fechaCalibracion, fecha_proxima_calibracion: dto.fechaProximaCalibracion,
      material: dto.material, estado_limpieza: dto.estadoLimpieza,
      producto_anterior: dto.productoAnterior, estado: dto.estado,
    };
    const presentes = Object.entries(columnas).filter(([, v]) => v !== undefined);
    if (!presentes.length) return antes;
    await gestor().query(
      `UPDATE cisternas SET ${presentes.map(([c], i) => `${c} = $${i + 2}`).join(', ')},
              actualizado_en = now() WHERE cisterna_id = $1`,
      [id, ...presentes.map(([, v]) => v)]);
    const despues = await this.obtener(id);
    auditar({ entidad: 'cisternas', entidadId: String(id), valorAnterior: antes, valorNuevo: despues });
    return despues;
  }

  async desactivar(id: string) {
    const antes = await this.obtener(id);
    if (['cargada', 'en_viaje'].includes(antes.estado)) throw new ConflictException(
      `La cisterna está ${antes.estado}; no se puede dar de baja`);
    await gestor().query(
      `UPDATE cisternas SET eliminado_en = now(), estado = 'mantenimiento', actualizado_en = now()
        WHERE cisterna_id = $1`, [id]);
    auditar({ entidad: 'cisternas', entidadId: String(id), valorAnterior: antes,
              valorNuevo: { ...antes, estado: 'mantenimiento', dadaDeBaja: true } });
    return { id, estado: 'mantenimiento', dadaDeBaja: true };
  }

  /* La base ya comprueba capacidad_calibrada <= capacidad_nominal por CHECK, y
     la unicidad del número por índice. Aquí se valida lo que la base NO puede:
     una regla ENTRE filas —la suma— que un CHECK de columna no alcanza. */
  private validarCompartimentos(comps: CompartimentoDto[], capacidadTotal: number) {
    const numeros = comps.map(c => c.numero);
    if (new Set(numeros).size !== numeros.length)
      throw new BadRequestException('Hay números de compartimento repetidos');

    const suma = comps.reduce((t, c) => t + c.capacidadNominal, 0);
    if (suma > capacidadTotal) throw new BadRequestException(
      `Los compartimentos suman ${suma}, más que la capacidad total de la cisterna (${capacidadTotal})`);
  }

  private async vehiculoDisponible(vehiculoId: string) {
    const [v] = await gestor().query(
      `SELECT tipo_vehiculo FROM vehiculos WHERE vehiculo_id = $1 AND eliminado_en IS NULL`, [vehiculoId]);
    if (!v) throw new BadRequestException('El vehículo indicado no existe');
    if (!['cisterna', 'integrada'].includes(v.tipo_vehiculo)) throw new BadRequestException(
      `Un vehículo de tipo "${v.tipo_vehiculo}" no puede llevar cisterna`);
    const [ocupado] = await gestor().query(
      `SELECT 1 FROM cisternas WHERE vehiculo_id = $1 AND eliminado_en IS NULL`, [vehiculoId]);
    if (ocupado) throw new ConflictException('Ese vehículo ya tiene una cisterna registrada');
  }
}
