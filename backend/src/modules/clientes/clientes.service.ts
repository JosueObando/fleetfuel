import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { unaFila } from '../../common/una-fila';
import { CrearClienteDto, ActualizarClienteDto } from './dto/clientes.dto';

const CAMPOS = `cliente_id AS id, nombre, razon_social AS "razonSocial", ruc,
                contacto, telefono, correo, estado, creado_en AS "creadoEn"`;

@Injectable()
export class ClientesService {
  /* Ninguna consulta lleva `WHERE empresa_id`: lo pone la RLS (ADR 003). El
     aislamiento no depende de que quien escriba la próxima query se acuerde. */
  listar() {
    return gestor().query(
      `SELECT ${CAMPOS} FROM clientes WHERE eliminado_en IS NULL ORDER BY nombre`);
  }

  async obtener(id: string) {
    const [fila] = await gestor().query(
      `SELECT ${CAMPOS} FROM clientes WHERE cliente_id = $1 AND eliminado_en IS NULL`, [id]);
    if (!fila) throw new NotFoundException('Cliente no encontrado');
    return fila;
  }

  async crear(dto: CrearClienteDto) {
    const ctx = contextoActual();
    await this.rucLibre(dto.ruc);

    const [creado] = await gestor().query(
      `INSERT INTO clientes (empresa_id, nombre, razon_social, ruc, contacto, telefono, correo)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${CAMPOS}`,
      [ctx.empresaId, dto.nombre, dto.razonSocial ?? null, dto.ruc ?? null,
       dto.contacto ?? null, dto.telefono ?? null, dto.correo ?? null]);

    auditar({ entidad: 'clientes', entidadId: String(creado.id), valorNuevo: creado });
    return creado;
  }

  async actualizar(id: string, dto: ActualizarClienteDto) {
    const antes = await this.obtener(id);
    if (dto.ruc && dto.ruc !== antes.ruc) await this.rucLibre(dto.ruc, id);

    /* Se construye el SET solo con lo que vino. `coalesce($n, columna)` no
       serviría: impediría para siempre poner un campo a NULL, porque no
       distingue «no lo mandes» de «bórralo». */
    const columnas: Record<string, unknown> = {
      nombre: dto.nombre, razon_social: dto.razonSocial, ruc: dto.ruc,
      contacto: dto.contacto, telefono: dto.telefono, correo: dto.correo, estado: dto.estado,
    };
    const presentes = Object.entries(columnas).filter(([, v]) => v !== undefined);
    if (presentes.length === 0) return antes;

    const asignaciones = presentes.map(([c], i) => `${c} = $${i + 2}`).join(', ');
    const despues = unaFila(await gestor().query(
      `UPDATE clientes SET ${asignaciones}, actualizado_en = now()
        WHERE cliente_id = $1 RETURNING ${CAMPOS}`,
      [id, ...presentes.map(([, v]) => v)]));

    auditar({ entidad: 'clientes', entidadId: String(id), valorAnterior: antes, valorNuevo: despues });
    return despues;
  }

  /* Baja lógica: el rol de la aplicación no tiene DELETE (regla 14). Borrar de
     verdad dejaría huérfanas las órdenes y los viajes que ya lo referencian. */
  async desactivar(id: string) {
    const antes = await this.obtener(id);
    const despues = unaFila(await gestor().query(
      `UPDATE clientes SET eliminado_en = now(), estado = 'inactivo', actualizado_en = now()
        WHERE cliente_id = $1 RETURNING ${CAMPOS}`, [id]));
    auditar({ entidad: 'clientes', entidadId: String(id), valorAnterior: antes, valorNuevo: despues });
    return despues;
  }

  /* La unicidad la garantiza el índice; esto solo convierte el 23505 en un 409
     con mensaje útil. La comprobación previa NO es la garantía: entre el
     SELECT y el INSERT cabe otra petición, y ahí la que manda es la base. */
  private async rucLibre(ruc?: string, exceptoId?: string) {
    if (!ruc) return;
    const [choque] = await gestor().query(
      `SELECT cliente_id FROM clientes
        WHERE ruc = $1 AND eliminado_en IS NULL AND ($2::bigint IS NULL OR cliente_id <> $2)`,
      [ruc, exceptoId ?? null]);
    if (choque) throw new ConflictException('Ya existe un cliente con ese RUC');
  }
}
