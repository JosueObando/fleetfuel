import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Append-only (§21). El rol de la aplicación no tiene UPDATE ni DELETE sobre
 * esta tabla: una corrección es un registro nuevo, nunca una edición.
 */
@Entity('auditoria')
export class RegistroAuditoria {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'auditoria_id' })
  id: string;

  @Column({ name: 'empresa_id', type: 'bigint' }) empresaId: string;
  @Column({ name: 'usuario_id', type: 'bigint', nullable: true }) usuarioId: string | null;
  @Column({ length: 80 }) accion: string;
  @Column({ length: 80 }) entidad: string;
  @Column({ name: 'entidad_id', length: 80, nullable: true }) entidadId: string | null;
  @Column({ name: 'valor_anterior', type: 'jsonb', nullable: true }) valorAnterior: unknown;
  @Column({ name: 'valor_nuevo', type: 'jsonb', nullable: true }) valorNuevo: unknown;
  @Column({ length: 400, nullable: true }) motivo: string | null;
  @Column({ type: 'inet', nullable: true }) ip: string | null;
  @Column({ length: 240, nullable: true }) dispositivo: string | null;
  @Column({ length: 240, nullable: true }) ruta: string | null;
  @Column({ name: 'ocurrido_en', type: 'timestamptz', default: () => 'now()' }) ocurridoEn: Date;
}
