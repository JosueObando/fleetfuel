import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { unaFila } from '../../common/una-fila';
import { RegistrarCargaDto, ValidarCargaDto } from './dto/cargas.dto';

const CAMPOS = `c.carga_id AS id, c.viaje_id AS "viajeId",
                c.compartimento_id AS "compartimentoId",
                c.detalle_orden_id AS "detalleOrdenId", c.producto_id AS "productoId",
                c.volumen_programado AS "volumenProgramado",
                c.volumen_cargado AS "volumenCargado",
                c.diferencia_programado AS "diferenciaProgramado",
                c.medidor_inicial AS "medidorInicial", c.medidor_final AS "medidorFinal",
                c.temperatura, c.densidad,
                c.numero_sello AS "numeroSello",
                c.operador_terminal AS "operadorTerminal",
                c.fecha_inicio AS "fechaInicio", c.fecha_fin AS "fechaFin",
                c.latitud, c.longitud,
                c.documento_carga AS "documentoCarga",
                c.evidencia_fotografica AS "evidenciaFotografica",
                c.estado_validacion AS "estadoValidacion",
                c.validada_por AS "validadaPor", c.fecha_validacion AS "fechaValidacion",
                c.motivo_validacion AS "motivoValidacion"`;

/**
 * La carga sólo se registra mientras el camión está cargando.
 *
 * §9 Etapa 5: al llegar a la terminal se confirman volúmenes y sellos, y el
 * viaje pasa a `Cargado` DESPUÉS. Aceptarla en `cargado` o más adelante
 * permitiría escribir a posteriori lo que se quiera que hubiera pasado, que es
 * justo lo que un registro de cadena de custodia no puede admitir.
 */
const CARGABLE = new Set(['cargando']);

@Injectable()
export class CargasService {
  async listarDeViaje(viajeId: string) {
    return gestor().query(
      `SELECT ${CAMPOS} FROM cargas_terminal c WHERE c.viaje_id = $1 ORDER BY c.carga_id`,
      [viajeId]);
  }

  async obtener(id: string) {
    const [fila] = await gestor().query(
      `SELECT ${CAMPOS} FROM cargas_terminal c WHERE c.carga_id = $1`, [id]);
    if (!fila) throw new NotFoundException('Carga no encontrada');
    return fila;
  }

  /**
   * Confirmar lo que salió de la terminal (§7.13, §9 Etapa 5).
   *
   * §5, literal: «Operador de carga — Confirma volúmenes cargados y sellos».
   */
  async registrar(viajeId: string, dto: RegistrarCargaDto) {
    const ctx = contextoActual();

    const [viaje] = await gestor().query(
      `SELECT estado FROM viajes WHERE viaje_id = $1`, [viajeId]);
    if (!viaje) throw new NotFoundException('Viaje no encontrado');
    if (!CARGABLE.has(viaje.estado))
      throw new ConflictException(
        `El viaje está "${viaje.estado}": sólo se registra la carga mientras el viaje carga`);

    // 1 · Regla 17 · «Toda carga debe relacionarse con un compartimento», y el
    //     compartimento tiene que llevar esa línea EN EL PLAN de este viaje.
    //     De aquí sale además el volumen programado: pedirlo en el cuerpo
    //     dejaría que quien captura lo ajustara a lo que cargó.
    const [plan] = await gestor().query(
      `SELECT pc.volumen_planificado, pc.producto_id, cc.capacidad_calibrada
         FROM plan_carga pc
         JOIN compartimentos_cisterna cc ON cc.compartimento_id = pc.compartimento_id
        WHERE pc.viaje_id = $1 AND pc.compartimento_id = $2 AND pc.detalle_orden_id = $3`,
      [viajeId, dto.compartimentoId, dto.detalleOrdenId]);
    if (!plan) throw new BadRequestException(
      'Ese compartimento no lleva carga planificada de esa línea en este viaje');

    // 2 · Reglas 4 y 19 · La capacidad CALIBRADA es el techo, no la nominal:
    //     lo que se puede facturar es lo que la calibración certifica.
    const calibrada = Number(plan.capacidad_calibrada);
    if (calibrada > 0 && dto.volumenCargado > calibrada)
      throw new BadRequestException(
        `No caben ${dto.volumenCargado}: la capacidad calibrada del compartimento es ${calibrada}`);

    // 3 · §10.4 · Los medidores van en pareja o no van.
    parejaDeMedidores(dto);

    let creada;
    try {
      creada = unaFila(await gestor().query(
        `INSERT INTO cargas_terminal
           (empresa_id, viaje_id, compartimento_id, detalle_orden_id, producto_id,
            volumen_programado, volumen_cargado, medidor_inicial, medidor_final,
            temperatura, densidad, numero_sello, operador_terminal,
            fecha_inicio, fecha_fin, latitud, longitud,
            documento_carga, evidencia_fotografica, firma_operador)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                 coalesce($14::timestamptz, now()),$15,$16,$17,$18,$19,$20)
         RETURNING ${CAMPOS.replace(/c\./g, '')}`,
        [ctx.empresaId, viajeId, dto.compartimentoId, dto.detalleOrdenId, plan.producto_id,
         plan.volumen_planificado, dto.volumenCargado,
         dto.medidorInicial ?? null, dto.medidorFinal ?? null,
         dto.temperatura ?? null, dto.densidad ?? null,
         dto.numeroSello, dto.operadorTerminal,
         dto.fechaInicio ?? null, dto.fechaFin ?? null, dto.latitud, dto.longitud,
         dto.documentoCarga ?? null, dto.evidenciaFotografica ?? null,
         dto.firmaOperador ?? null]));
    } catch (e) {
      traducir(e, dto);
    }

    auditar({
      entidad: 'cargas_terminal', entidadId: String(creada.id),
      valorNuevo: {
        ...dto, volumenProgramado: plan.volumen_planificado, estadoValidacion: 'pendiente',
      },
    });
    return this.obtener(String(creada.id));
  }

  /** Dar por buena una carga. Permiso propio: confirmar no es validar. */
  async validar(id: string, dto: ValidarCargaDto) {
    return this.resolver(id, 'validada', dto);
  }

  /** El otro final: lo que dice el acta no es lo que hay en el camión. */
  async rechazar(id: string, dto: ValidarCargaDto) {
    if (!dto?.motivo) throw new BadRequestException('Rechazar una carga exige un motivo');
    return this.resolver(id, 'rechazada', dto);
  }

  private async resolver(id: string, estado: 'validada' | 'rechazada', dto: ValidarCargaDto) {
    const ctx = contextoActual();
    const antes = await this.obtener(id);
    if (antes.estadoValidacion !== 'pendiente')
      throw new ConflictException(
        `La carga no está pendiente: está "${antes.estadoValidacion}"`);

    await gestor().query(
      `UPDATE cargas_terminal
          SET estado_validacion = $2, validada_por = $3, fecha_validacion = now(),
              motivo_validacion = $4, actualizado_en = now()
        WHERE carga_id = $1`, [id, estado, ctx.usuarioId, dto?.motivo ?? null]);

    auditar({
      entidad: 'cargas_terminal', entidadId: String(id), motivo: dto?.motivo,
      valorAnterior: { estadoValidacion: antes.estadoValidacion },
      valorNuevo: { estadoValidacion: estado, validadaPor: ctx.usuarioId },
    });
    return this.obtener(id);
  }
}

/**
 * §10.4 · «Volumen medido = lectura final − lectura inicial».
 *
 * Mismo criterio que en la entrega, y por eso mismo texto: media lectura no
 * permite calcular nada.
 */
function parejaDeMedidores(dto: RegistrarCargaDto): void {
  const { medidorInicial: ini, medidorFinal: fin } = dto;
  if (ini == null && fin == null) return;
  if (ini == null || fin == null)
    throw new BadRequestException(
      'Los medidores van en pareja: falta la lectura inicial o la final');
  if (fin < ini)
    throw new BadRequestException(
      `El medidor final (${fin}) no puede ser menor que el inicial (${ini})`);
}

/** Las restricciones de la base que son reglas de negocio, en su idioma. */
function traducir(e: unknown, dto: RegistrarCargaDto): never {
  const restriccion = (e as { constraint?: string })?.constraint ?? '';
  // Regla 5 · «Cada compartimento debe tener un único producto durante el
  // viaje»: una carga por compartimento y viaje.
  if (restriccion === 'uq_cargas_viaje_compartimento')
    throw new ConflictException(
      'Ese compartimento ya tiene una carga registrada en este viaje');
  // Regla 18 · Un sello identifica UNA carga. Si se repitiera, verificarlo en
  // la entrega dejaría de significar algo.
  if (restriccion === 'uq_cargas_sello')
    throw new ConflictException(`El sello "${dto.numeroSello}" ya está registrado en otra carga`);
  // `ck_cargas_medidores` NO se traduce aquí a propósito: `parejaDeMedidores`
  // dispara antes de llegar al INSERT, así que esta rama no podría ejecutarse
  // nunca. Una rama inalcanzable no es defensa en profundidad, es código muerto
  // que además obliga a escribir una prueba que finja alcanzarla. La
  // restricción sigue en la base, que es donde protege de verdad si algún día
  // alguien inserta por otro camino.
  if (restriccion === 'ck_cargas_geo')
    throw new BadRequestException('La geolocalización de la carga no es una coordenada válida');
  if (restriccion === 'ck_cargas_densidad')
    throw new BadRequestException('La densidad tiene que ser un valor físico mayor que cero');
  if (restriccion === 'ck_cargas_fechas')
    throw new BadRequestException('La carga no puede terminar antes de empezar');
  throw e as Error;
}
