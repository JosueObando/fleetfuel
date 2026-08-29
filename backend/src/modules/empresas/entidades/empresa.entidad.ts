import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('empresas')
export class Empresa {
  // bigint viaja como string a propósito: por encima de 2^53 el number de
  // JavaScript pierde precisión silenciosamente, y un id truncado en una tabla
  // de 700 millones de filas (§5.2) es un error que no da la cara hasta tarde.
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'empresa_id' })
  id: string;

  @Column({ length: 160 }) nombre: string;
  @Column({ length: 40 }) ruc: string;
  @Column({ length: 20, default: 'activa' }) estado: 'activa' | 'suspendida';
  @Column({ name: 'creado_en', type: 'timestamptz', default: () => 'now()' }) creadoEn: Date;
  @Column({ name: 'actualizado_en', type: 'timestamptz', default: () => 'now()' }) actualizadoEn: Date;
  @Column({ name: 'eliminado_en', type: 'timestamptz', nullable: true }) eliminadoEn: Date | null;
}
