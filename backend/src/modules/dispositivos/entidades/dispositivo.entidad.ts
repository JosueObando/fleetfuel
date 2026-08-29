import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** §7 «Bloqueo remoto»: revocar aquí invalida el refresh token en Redis. */
@Entity('dispositivos')
export class Dispositivo {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'dispositivo_id' })
  id: string;

  @Column({ name: 'empresa_id', type: 'bigint' }) empresaId: string;
  @Column({ name: 'usuario_id', type: 'bigint' }) usuarioId: string;
  @Column({ length: 120 }) identificador: string;
  @Column({ length: 120, nullable: true }) nombre: string | null;
  @Column({ length: 40, nullable: true }) plataforma: string | null;
  @Column({ name: 'ultimo_uso_en', type: 'timestamptz', nullable: true }) ultimoUsoEn: Date | null;
  @Column({ name: 'creado_en', type: 'timestamptz', default: () => 'now()' }) creadoEn: Date;
  @Column({ name: 'revocado_en', type: 'timestamptz', nullable: true }) revocadoEn: Date | null;
  @Column({ name: 'revocado_por', type: 'bigint', nullable: true }) revocadoPor: string | null;
}
