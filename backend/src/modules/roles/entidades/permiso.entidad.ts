import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Catálogo global: el vocabulario de permisos es del sistema, no de la empresa. */
@Entity('permisos')
export class Permiso {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'permiso_id' })
  id: string;

  @Column({ length: 80 }) codigo: string;
  @Column({ length: 240 }) descripcion: string;
  @Column({ length: 40 }) modulo: string;
}
