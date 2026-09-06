import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { unaFila } from '../../common/una-fila';
import { CrearConductorDto, ActualizarConductorDto } from './dto/conductores.dto';

/*
 * La cuenta bancaria NO se escribe en 1A, y es deliberado.
 *
 * La columna `cuenta_bancaria_cifrada` existe, igual que `cedula_cifrada` en
 * `usuarios` desde la Fase 0 — y esa lleva sin usarse por la misma razón: NO
 * HAY todavía un mecanismo de gestión de claves. Cifrar exige decidir dónde
 * vive la clave, cómo se rota y quién puede descifrar; resolverlo de pasada
 * aquí produciría cifrado que parece protección y no lo es.
 *
 * El dato no hace falta hasta las liquidaciones (Fase 1C). Hasta entonces la
 * API solo informa si hay cuenta guardada o no, y nunca la devuelve: un
 * listado de conductores no es sitio para datos bancarios de una persona.
 */
const CAMPOS = `conductor_id AS id, usuario_id AS "usuarioId", nombre_completo AS "nombreCompleto",
                documento, licencia, categoria,
                fecha_vencimiento_licencia AS "fechaVencimientoLicencia",
                telefono, correo, estado, tarifa_base AS "tarifaBase", tarifa_km AS "tarifaKm",
                tarifa_viaje AS "tarifaViaje", tarifa_entrega AS "tarifaEntrega",
                (cuenta_bancaria_cifrada IS NOT NULL) AS "tieneCuentaBancaria",
                contacto_emergencia AS "contactoEmergencia",
                (fecha_vencimiento_licencia IS NOT NULL
                 AND fecha_vencimiento_licencia < current_date) AS "licenciaVencida"`;

@Injectable()
export class ConductoresService {
  listar() {
    return gestor().query(
      `SELECT ${CAMPOS} FROM conductores WHERE eliminado_en IS NULL ORDER BY nombre_completo`);
  }

  /** Licencias vencidas o por vencer: el control que pide §6.6. */
  porVencer(dias: number) {
    return gestor().query(
      `SELECT ${CAMPOS} FROM conductores
        WHERE eliminado_en IS NULL AND fecha_vencimiento_licencia IS NOT NULL
          AND fecha_vencimiento_licencia <= current_date + ($1 || ' days')::interval
        ORDER BY fecha_vencimiento_licencia`, [dias]);
  }

  async obtener(id: string) {
    const [f] = await gestor().query(
      `SELECT ${CAMPOS} FROM conductores WHERE conductor_id = $1 AND eliminado_en IS NULL`, [id]);
    if (!f) throw new NotFoundException('Conductor no encontrado');
    return f;
  }

  async crear(dto: CrearConductorDto) {
    const ctx = contextoActual();
    await this.identificadoresLibres(dto.documento, dto.licencia);

    const [creado] = await gestor().query(
      `INSERT INTO conductores
         (empresa_id, usuario_id, nombre_completo, documento, licencia, categoria,
          fecha_vencimiento_licencia, telefono, correo, tarifa_base, tarifa_km,
          tarifa_viaje, tarifa_entrega, contacto_emergencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING ${CAMPOS}`,
      [ctx.empresaId, dto.usuarioId ?? null, dto.nombreCompleto, dto.documento, dto.licencia,
       dto.categoria ?? null, dto.fechaVencimientoLicencia ?? null, dto.telefono ?? null,
       dto.correo ?? null, dto.tarifaBase ?? null, dto.tarifaKm ?? null, dto.tarifaViaje ?? null,
       dto.tarifaEntrega ?? null, dto.contactoEmergencia ?? null]);

    auditar({ entidad: 'conductores', entidadId: String(creado.id), valorNuevo: creado });
    return creado;
  }

  async actualizar(id: string, dto: ActualizarConductorDto) {
    const antes = await this.obtener(id);
    await this.identificadoresLibres(
      dto.documento !== antes.documento ? dto.documento : undefined,
      dto.licencia !== antes.licencia ? dto.licencia : undefined, id);

    const columnas: Record<string, unknown> = {
      usuario_id: dto.usuarioId, nombre_completo: dto.nombreCompleto, documento: dto.documento,
      licencia: dto.licencia, categoria: dto.categoria,
      fecha_vencimiento_licencia: dto.fechaVencimientoLicencia, telefono: dto.telefono,
      correo: dto.correo, tarifa_base: dto.tarifaBase, tarifa_km: dto.tarifaKm,
      tarifa_viaje: dto.tarifaViaje, tarifa_entrega: dto.tarifaEntrega,
      contacto_emergencia: dto.contactoEmergencia, estado: dto.estado,
    };
    const presentes = Object.entries(columnas).filter(([, v]) => v !== undefined);
    const asignaciones = presentes.map(([c], i) => `${c} = $${i + 2}`);
    const valores: unknown[] = presentes.map(([, v]) => v);

    if (!asignaciones.length) return antes;

    const despues = unaFila(await gestor().query(

      `UPDATE conductores SET ${asignaciones.join(', ')}, actualizado_en = now()
        WHERE conductor_id = $1 RETURNING ${CAMPOS}`, [id, ...valores]));
    auditar({ entidad: 'conductores', entidadId: String(id), valorAnterior: antes, valorNuevo: despues });
    return despues;
  }

  async desactivar(id: string) {
    const antes = await this.obtener(id);
    if (antes.estado === 'en_viaje')
      throw new ConflictException('El conductor está en viaje; no se puede dar de baja');
    const despues = unaFila(await gestor().query(
      `UPDATE conductores SET eliminado_en = now(), estado = 'suspendido', actualizado_en = now()
        WHERE conductor_id = $1 RETURNING ${CAMPOS}`, [id]));
    auditar({ entidad: 'conductores', entidadId: String(id), valorAnterior: antes, valorNuevo: despues });
    return despues;
  }

  private async identificadoresLibres(documento?: string, licencia?: string, exceptoId?: string) {
    for (const [columna, valor, mensaje] of [
      ['documento', documento, 'Ya existe un conductor con ese documento'],
      ['licencia', licencia, 'Ya existe un conductor con esa licencia'],
    ] as const) {
      if (!valor) continue;
      const [choque] = await gestor().query(
        `SELECT conductor_id FROM conductores
          WHERE ${columna} = $1 AND eliminado_en IS NULL
            AND ($2::bigint IS NULL OR conductor_id <> $2)`, [valor, exceptoId ?? null]);
      if (choque) throw new ConflictException(mensaje);
    }
  }
}
