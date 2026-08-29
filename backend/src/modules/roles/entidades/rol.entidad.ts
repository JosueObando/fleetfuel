import { Column, Entity, JoinTable, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Permiso } from './permiso.entidad';

@Entity('roles')
export class Rol {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'rol_id' })
  id: string;

  @Column({ name: 'empresa_id', type: 'bigint' }) empresaId: string;
  @Column({ length: 80 }) nombre: string;
  @Column({ type: 'varchar', length: 240, nullable: true }) descripcion: string | null;

  /** §7: TOTP obligatorio para Administrador, Finanzas y Auditor. */
  @Column({ name: 'exige_mfa', default: false }) exigeMfa: boolean;

  @Column({ name: 'creado_en', type: 'timestamptz', default: () => 'now()' }) creadoEn: Date;

  @ManyToMany(() => Permiso, { eager: true })
  @JoinTable({
    name: 'roles_permisos',
    joinColumn: { name: 'rol_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permiso_id', referencedColumnName: 'id' },
  })
  permisos: Permiso[];
}
