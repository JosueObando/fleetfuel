import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * §14 · El permiso de los informes.
 *
 * Uno solo y de lectura: los informes no escriben nada, y partirlo por informe
 * —«operativo:leer», «mermas:leer»— multiplicaría el catálogo sin separar
 * ninguna función real. La separación que importa en este sistema es entre
 * quien captura y quien aprueba, y ahí ya está.
 *
 * Va aparte de `auditoria:leer` porque son cosas distintas: la auditoría dice
 * QUIÉN hizo qué, y los informes dicen CUÁNTO. Un rol puede necesitar los
 * números sin poder mirar la bitácora de sus compañeros.
 */
export class PermisoInformes1797000000000 implements MigrationInterface {
  name = 'PermisoInformes1797000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO permisos (codigo, modulo, descripcion)
       VALUES ('informes:leer','informes','Ver los reportes del §14')
       ON CONFLICT (codigo) DO NOTHING`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM roles_permisos WHERE permiso_id IN
                     (SELECT permiso_id FROM permisos WHERE codigo = 'informes:leer')`);
    await q.query(`DELETE FROM permisos WHERE codigo = 'informes:leer'`);
  }
}
