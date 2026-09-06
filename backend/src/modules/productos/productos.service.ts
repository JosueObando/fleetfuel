import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { unaFila } from '../../common/una-fila';
import { CrearProductoDto, ActualizarProductoDto } from './dto/productos.dto';

const CAMPOS = `producto_id AS id, codigo, nombre, unidad_medida AS "unidadMedida",
                densidad_referencia AS "densidadReferencia", tolerancia_merma AS "toleranciaMerma",
                requiere_temperatura AS "requiereTemperatura",
                color_identificacion AS "colorIdentificacion", estado`;

@Injectable()
export class ProductosService {
  listar() {
    return gestor().query(
      `SELECT ${CAMPOS} FROM productos_combustible WHERE eliminado_en IS NULL ORDER BY nombre`);
  }

  async obtener(id: string) {
    const [f] = await gestor().query(
      `SELECT ${CAMPOS} FROM productos_combustible WHERE producto_id = $1 AND eliminado_en IS NULL`, [id]);
    if (!f) throw new NotFoundException('Producto no encontrado');
    return f;
  }

  async crear(dto: CrearProductoDto) {
    const ctx = contextoActual();
    await this.codigoLibre(dto.codigo);
    const [creado] = await gestor().query(
      `INSERT INTO productos_combustible
         (empresa_id, codigo, nombre, unidad_medida, densidad_referencia,
          tolerancia_merma, requiere_temperatura, color_identificacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${CAMPOS}`,
      [ctx.empresaId, dto.codigo, dto.nombre, dto.unidadMedida ?? 'litros',
       dto.densidadReferencia ?? null, dto.toleranciaMerma ?? 0,
       dto.requiereTemperatura ?? false, dto.colorIdentificacion ?? null]);
    auditar({ entidad: 'productos_combustible', entidadId: String(creado.id), valorNuevo: creado });
    return creado;
  }

  async actualizar(id: string, dto: ActualizarProductoDto) {
    const antes = await this.obtener(id);
    if (dto.codigo && dto.codigo !== antes.codigo) await this.codigoLibre(dto.codigo, id);
    const columnas: Record<string, unknown> = {
      codigo: dto.codigo, nombre: dto.nombre, unidad_medida: dto.unidadMedida,
      densidad_referencia: dto.densidadReferencia, tolerancia_merma: dto.toleranciaMerma,
      requiere_temperatura: dto.requiereTemperatura,
      color_identificacion: dto.colorIdentificacion, estado: dto.estado,
    };
    const presentes = Object.entries(columnas).filter(([, v]) => v !== undefined);
    if (!presentes.length) return antes;
    const [despues] = await gestor().query(
      `UPDATE productos_combustible SET ${presentes.map(([c], i) => `${c} = $${i + 2}`).join(', ')},
              actualizado_en = now()
        WHERE producto_id = $1 RETURNING ${CAMPOS}`,
      [id, ...presentes.map(([, v]) => v)]);
    auditar({ entidad: 'productos_combustible', entidadId: String(id), valorAnterior: antes, valorNuevo: despues });
    return despues;
  }

  async desactivar(id: string) {
    const antes = await this.obtener(id);
    /* Un producto en uso no se da de baja: los compartimentos que lo declaran
       permitido quedarían apuntando a un catálogo muerto y el plan de carga
       de la Fase 1B validaría contra algo que ya no existe. */
    const [enUso] = await gestor().query(
      `SELECT 1 FROM compartimentos_cisterna WHERE producto_permitido = $1 LIMIT 1`, [id]);
    if (enUso) throw new ConflictException(
      'El producto está asignado a compartimentos; quítalo de ellos antes de darlo de baja');
    const despues = unaFila(await gestor().query(
      `UPDATE productos_combustible SET eliminado_en = now(), estado = 'inactivo', actualizado_en = now()
        WHERE producto_id = $1 RETURNING ${CAMPOS}`, [id]));
    auditar({ entidad: 'productos_combustible', entidadId: String(id), valorAnterior: antes, valorNuevo: despues });
    return despues;
  }

  private async codigoLibre(codigo: string, exceptoId?: string) {
    const [choque] = await gestor().query(
      `SELECT producto_id FROM productos_combustible
        WHERE codigo = $1 AND eliminado_en IS NULL AND ($2::bigint IS NULL OR producto_id <> $2)`,
      [codigo, exceptoId ?? null]);
    if (choque) throw new ConflictException('Ya existe un producto con ese código');
  }
}
