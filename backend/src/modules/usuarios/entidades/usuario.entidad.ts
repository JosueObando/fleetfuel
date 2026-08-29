import { Column, Entity, JoinTable, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Rol } from '../../roles/entidades/rol.entidad';

@Entity('usuarios')
export class Usuario {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'usuario_id' })
  id: string;

  @Column({ name: 'empresa_id', type: 'bigint' }) empresaId: string;
  @Column({ length: 160 }) nombre: string;
  @Column({ length: 160 }) correo: string;

  // select:false — un SELECT descuidado no debe arrastrar el hash a un DTO,
  // a un log ni a una respuesta. Se pide explícitamente donde hace falta.
  @Column({ name: 'hash_clave', length: 120, select: false }) hashClave: string;

  @Column({ length: 40, nullable: true }) telefono: string | null;
  @Column({ length: 20, default: 'activo' }) estado: 'activo' | 'suspendido';

  @Column({ name: 'mfa_habilitado', default: false }) mfaHabilitado: boolean;

  /** Secreto TOTP cifrado con AES-256-GCM por la aplicación (ver CifradoService). */
  @Column({ name: 'mfa_secreto', type: 'text', nullable: true, select: false })
  mfaSecreto: string | null;

  @Column({ name: 'mfa_confirmado_en', type: 'timestamptz', nullable: true })
  mfaConfirmadoEn: Date | null;

  @Column({ name: 'ultimo_acceso_en', type: 'timestamptz', nullable: true })
  ultimoAccesoEn: Date | null;

  @Column({ name: 'creado_en', type: 'timestamptz', default: () => 'now()' }) creadoEn: Date;
  @Column({ name: 'actualizado_en', type: 'timestamptz', default: () => 'now()' }) actualizadoEn: Date;
  @Column({ name: 'eliminado_en', type: 'timestamptz', nullable: true }) eliminadoEn: Date | null;

  @ManyToMany(() => Rol, { eager: true })
  @JoinTable({
    name: 'usuarios_roles',
    joinColumn: { name: 'usuario_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'rol_id', referencedColumnName: 'id' },
  })
  roles: Rol[];
}
