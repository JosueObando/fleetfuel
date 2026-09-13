import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { ResolverAlertaDto } from './dto/alertas.dto';

const CAMPOS = `a.alerta_id AS id, a.tipo, a.severidad, a.titulo, a.detalle,
                a.entidad, a.entidad_id AS "entidadId", a.viaje_id AS "viajeId",
                a.clave_dedup AS "claveDedup", a.estado,
                a.detectada_en AS "detectadaEn",
                a.reconocida_por AS "reconocidaPor", a.reconocida_en AS "reconocidaEn",
                a.resuelta_en AS "resueltaEn", a.motivo_cierre AS "motivoCierre"`;

/**
 * Umbrales de las reglas.
 *
 * Estan aqui y no repartidos por las consultas porque son la parte que la
 * operacion real VA a cambiar: el primer mes dira si 90 km/h es demasiado para
 * una cisterna cargada o si 15 minutos de parada es poco. Que se cambien en un
 * sitio es lo que evita que alguien ajuste uno y se olvide del gemelo.
 */
export const UMBRALES = {
  velocidadMaximaKmh: 90,
  segundosSinGps: 600,
  minutosParadaNoAutorizada: 20,
  diasAntesDeVencer: 30,
};

interface Hallazgo {
  tipo: string;
  severidad: 'baja' | 'media' | 'alta' | 'critica';
  titulo: string;
  entidad: string;
  entidadId?: string | null;
  viajeId?: string | null;
  claveDedup: string;
  detalle?: Record<string, unknown>;
}

@Injectable()
export class AlertasService {
  async listar(estado = 'abiertas') {
    const filtro = estado === 'todas' ? '' : `WHERE a.estado <> 'resuelta'`;
    return gestor().query(
      `SELECT ${CAMPOS} FROM alertas a ${filtro}
        ORDER BY CASE a.severidad WHEN 'critica' THEN 0 WHEN 'alta' THEN 1
                                  WHEN 'media' THEN 2 ELSE 3 END,
                 a.detectada_en DESC
        LIMIT 500`);
  }

  async obtener(id: string) {
    const [fila] = await gestor().query(
      `SELECT ${CAMPOS} FROM alertas a WHERE a.alerta_id = $1`, [id]);
    if (!fila) throw new NotFoundException('Alerta no encontrada');
    return fila;
  }

  async reconocer(id: string) {
    const ctx = contextoActual();
    const antes = await this.obtener(id);
    if (antes.estado !== 'abierta')
      throw new ConflictException(`Esa alerta ya está "${antes.estado}"`);
    await gestor().query(
      `UPDATE alertas SET estado = 'reconocida', reconocida_por = $2, reconocida_en = now()
        WHERE alerta_id = $1`, [id, ctx.usuarioId]);
    auditar({ entidad: 'alertas', entidadId: String(id),
              valorAnterior: { estado: antes.estado }, valorNuevo: { estado: 'reconocida' } });
    return this.obtener(id);
  }

  /**
   * Cerrar una alerta.
   *
   * Exige motivo porque una alerta cerrada sin explicacion es indistinguible de
   * una que alguien silencio para quitarla de la lista — y como la
   * deduplicacion permite que vuelva a abrirse, sin el motivo nadie sabra si ya
   * paso antes ni que se hizo.
   */
  async resolver(id: string, dto: ResolverAlertaDto) {
    const antes = await this.obtener(id);
    if (antes.estado === 'resuelta')
      throw new ConflictException('Esa alerta ya está resuelta');
    await gestor().query(
      `UPDATE alertas SET estado = 'resuelta', resuelta_en = now(), motivo_cierre = $2
        WHERE alerta_id = $1`, [id, dto.motivo]);
    auditar({ entidad: 'alertas', entidadId: String(id), motivo: dto.motivo,
              valorAnterior: { estado: antes.estado }, valorNuevo: { estado: 'resuelta' } });
    return this.obtener(id);
  }

  /**
   * Evaluar las reglas del §22 y registrar lo que encuentre.
   *
   * Es idempotente por diseno: cada hallazgo trae su `claveDedup`, que
   * identifica el HECHO y no la fila que lo detecto. Evaluar mil veces produce
   * una alerta por problema, no mil. Una alerta que se recrea en cada pasada no
   * es una alerta: es ruido, y el ruido se ignora.
   */
  async evaluar() {
    const hallazgos: Hallazgo[] = [
      ...(await this.excesoDeVelocidad()),
      ...(await this.perdidaDeGps()),
      ...(await this.selloInconsistente()),
      ...(await this.diferenciaDeVolumen()),
      ...(await this.documentosVencidos()),
      ...(await this.viajeSinCerrar()),
      ...(await this.liquidacionPendiente()),
      ...(await this.gastoSinComprobante()),
    ];

    let nuevas = 0;
    for (const h of hallazgos) {
      const creada = await this.registrar(h);
      if (creada) nuevas++;
    }
    return { evaluadas: hallazgos.length, nuevas, yaAbiertas: hallazgos.length - nuevas };
  }

  /** Inserta si el hecho no tiene ya una alerta viva. Devuelve si creo una. */
  private async registrar(h: Hallazgo): Promise<boolean> {
    const ctx = contextoActual();
    const filas = await gestor().query(
      `INSERT INTO alertas (empresa_id, tipo, severidad, titulo, detalle, entidad,
                            entidad_id, viaje_id, clave_dedup)
       -- El ::text no es adorno: el parametro 9 aparece en la proyeccion y en
       -- el EXISTS, y sin decirle el tipo Postgres deduce uno distinto en cada
       -- sitio y se niega con «inconsistent types deduced for parameter».
       SELECT $1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::text
        WHERE NOT EXISTS (
          SELECT 1 FROM alertas
           WHERE empresa_id = $1 AND clave_dedup = $9::text AND estado <> 'resuelta')
       RETURNING alerta_id`,
      [ctx.empresaId, h.tipo, h.severidad, h.titulo,
       h.detalle ? JSON.stringify(h.detalle) : null,
       h.entidad, h.entidadId ?? null, h.viajeId ?? null, h.claveDedup]);
    return filas.length > 0;
  }

  // ── Las reglas ─────────────────────────────────────────────────────────

  private async excesoDeVelocidad(): Promise<Hallazgo[]> {
    const filas = await gestor().query(
      `SELECT p.viaje_id, max(p.velocidad) AS maxima, count(*) AS lecturas,
              v.codigo_viaje
         FROM posiciones_gps p
         JOIN viajes v ON v.viaje_id = p.viaje_id
        WHERE p.velocidad > $1 AND v.estado NOT IN ('cerrado','cancelado')
        GROUP BY p.viaje_id, v.codigo_viaje`, [UMBRALES.velocidadMaximaKmh]);
    return filas.map((f: Record<string, string>) => ({
      tipo: 'exceso_velocidad', severidad: 'alta' as const,
      titulo: `Exceso de velocidad en el viaje ${f.codigo_viaje}: ${f.maxima} km/h`,
      entidad: 'viajes', entidadId: String(f.viaje_id), viajeId: String(f.viaje_id),
      // La clave lleva el viaje y no la lectura: el hecho es «este viaje corrio
      // de mas», y una alerta por cada muestra a 91 km/h seria ruido puro.
      claveDedup: `exceso_velocidad:viaje:${f.viaje_id}`,
      detalle: { maxima: f.maxima, lecturas: Number(f.lecturas),
                 umbral: UMBRALES.velocidadMaximaKmh },
    }));
  }

  private async perdidaDeGps(): Promise<Hallazgo[]> {
    const filas = await gestor().query(
      `SELECT v.viaje_id, v.codigo_viaje,
              max(p.fecha_hora) AS ultima,
              extract(epoch FROM (now() - max(p.fecha_hora)))::int AS silencio
         FROM viajes v
         LEFT JOIN posiciones_gps p ON p.viaje_id = v.viaje_id
        WHERE v.estado IN ('desplazamiento_terminal','espera_carga','cargando','cargado',
                           'transito_estacion','descargando','retornando')
        GROUP BY v.viaje_id, v.codigo_viaje
       HAVING max(p.fecha_hora) IS NULL
           OR extract(epoch FROM (now() - max(p.fecha_hora))) > $1`,
      [UMBRALES.segundosSinGps]);
    return filas.map((f: Record<string, string>) => ({
      tipo: 'perdida_gps', severidad: 'alta' as const,
      titulo: f.ultima
        ? `Sin señal GPS en el viaje ${f.codigo_viaje} desde hace ${Math.round(Number(f.silencio) / 60)} min`
        : `El viaje ${f.codigo_viaje} está en marcha y nunca ha enviado posición`,
      entidad: 'viajes', entidadId: String(f.viaje_id), viajeId: String(f.viaje_id),
      claveDedup: `perdida_gps:viaje:${f.viaje_id}`,
      detalle: { ultima: f.ultima, silencioSegundos: f.silencio ? Number(f.silencio) : null },
    }));
  }

  private async selloInconsistente(): Promise<Hallazgo[]> {
    const filas = await gestor().query(
      `SELECT e.entrega_id, e.viaje_id, e.estado_sello, e.sello_recibido
         FROM entregas e WHERE e.estado_sello IN ('roto','inconsistente')`);
    return filas.map((f: Record<string, string>) => ({
      // La regla 18 del §11: todo sello se verifica en la entrega. Un sello
      // roto es la senal mas directa de manipulacion de la carga.
      tipo: 'sello_inconsistente', severidad: 'critica' as const,
      titulo: `Sello ${f.estado_sello} en una entrega`,
      entidad: 'entregas', entidadId: String(f.entrega_id), viajeId: String(f.viaje_id),
      claveDedup: `sello:entrega:${f.entrega_id}`,
      detalle: { estadoSello: f.estado_sello, sello: f.sello_recibido },
    }));
  }

  private async diferenciaDeVolumen(): Promise<Hallazgo[]> {
    const filas = await gestor().query(
      `SELECT e.entrega_id, e.viaje_id, e.porcentaje_merma, e.diferencia_volumen
         FROM entregas e WHERE e.estado = 'pendiente'`);
    return filas.map((f: Record<string, string>) => ({
      tipo: 'diferencia_volumen', severidad: 'alta' as const,
      titulo: `Diferencia de volumen fuera de tolerancia: ${f.porcentaje_merma} %`,
      entidad: 'entregas', entidadId: String(f.entrega_id), viajeId: String(f.viaje_id),
      claveDedup: `diferencia_volumen:entrega:${f.entrega_id}`,
      detalle: { porcentajeMerma: f.porcentaje_merma, diferencia: f.diferencia_volumen },
    }));
  }

  private async documentosVencidos(): Promise<Hallazgo[]> {
    const filas = await gestor().query(
      `SELECT conductor_id, nombre_completo, fecha_vencimiento_licencia,
              (fecha_vencimiento_licencia < current_date) AS vencida
         FROM conductores
        WHERE eliminado_en IS NULL
          AND fecha_vencimiento_licencia IS NOT NULL
          AND fecha_vencimiento_licencia < current_date + ($1 || ' days')::interval`,
      [UMBRALES.diasAntesDeVencer]);
    return filas.map((f: Record<string, string>) => ({
      // La regla 13 del §11 dice que los documentos vencidos BLOQUEAN la
      // asignacion. Avisar 30 dias antes es lo que evita que el bloqueo llegue
      // por sorpresa la manana de un despacho.
      tipo: 'licencia_por_vencer',
      severidad: (f.vencida ? 'critica' : 'media'),
      titulo: f.vencida
        ? `Licencia VENCIDA de ${f.nombre_completo}`
        : `Licencia de ${f.nombre_completo} por vencer`,
      entidad: 'conductores', entidadId: String(f.conductor_id),
      claveDedup: `licencia:conductor:${f.conductor_id}:${f.fecha_vencimiento_licencia}`,
      detalle: { vence: f.fecha_vencimiento_licencia, vencida: f.vencida },
    }));
  }

  private async viajeSinCerrar(): Promise<Hallazgo[]> {
    const filas = await gestor().query(
      `SELECT viaje_id, codigo_viaje, fecha_programada
         FROM viajes
        WHERE estado = 'pendiente_liquidacion'
          AND fecha_programada < now() - interval '7 days'`);
    return filas.map((f: Record<string, string>) => ({
      tipo: 'viaje_sin_cerrar', severidad: 'media' as const,
      titulo: `El viaje ${f.codigo_viaje} lleva más de una semana sin cerrar`,
      entidad: 'viajes', entidadId: String(f.viaje_id), viajeId: String(f.viaje_id),
      claveDedup: `viaje_sin_cerrar:viaje:${f.viaje_id}`,
      detalle: { fechaProgramada: f.fecha_programada },
    }));
  }

  private async liquidacionPendiente(): Promise<Hallazgo[]> {
    const filas = await gestor().query(
      `SELECT v.viaje_id, v.codigo_viaje
         FROM viajes v
         LEFT JOIN liquidaciones_conductor l ON l.viaje_id = v.viaje_id
        WHERE v.estado = 'cerrado' AND l.liquidacion_id IS NULL
          AND v.fecha_fin < now() - interval '7 days'`);
    return filas.map((f: Record<string, string>) => ({
      tipo: 'liquidacion_pendiente', severidad: 'media' as const,
      titulo: `El viaje ${f.codigo_viaje} está cerrado y sin liquidar`,
      entidad: 'viajes', entidadId: String(f.viaje_id), viajeId: String(f.viaje_id),
      claveDedup: `liquidacion_pendiente:viaje:${f.viaje_id}`,
    }));
  }

  private async gastoSinComprobante(): Promise<Hallazgo[]> {
    const filas = await gestor().query(
      `SELECT gasto_id, viaje_id, monto, categoria
         FROM gastos_viaje
        WHERE estado = 'aprobado' AND comprobante IS NULL AND reembolsable`);
    return filas.map((f: Record<string, string>) => ({
      tipo: 'gasto_sin_comprobante', severidad: 'media' as const,
      titulo: `Gasto reembolsable aprobado sin comprobante: ${f.monto}`,
      entidad: 'gastos_viaje', entidadId: String(f.gasto_id), viajeId: String(f.viaje_id),
      claveDedup: `gasto_sin_comprobante:gasto:${f.gasto_id}`,
      detalle: { monto: f.monto, categoria: f.categoria },
    }));
  }
}
