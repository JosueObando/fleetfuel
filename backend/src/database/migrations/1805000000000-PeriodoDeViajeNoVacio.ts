import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Un viaje tiene que OCUPAR tiempo.
 *
 * `periodo` es `tstzrange(coalesce(fecha_inicio, fecha_programada), fecha_fin)`,
 * y con el fin IGUAL al inicio el rango sale vacío. Un rango vacío no se solapa
 * con nada, así que las dos exclusiones del §5.1 —cisterna y conductor— no lo
 * ven: el viaje no reserva nada y se puede programar otro encima.
 *
 * No era un caso raro. La pantalla pedía el día de salida y el día de fin, y un
 * viaje de un día lleva el mismo día en los dos: 16 de los 29 viajes de
 * desarrollo estaban así, los 15 autorizados incluidos. Producción no tenía
 * ninguno.
 *
 * NOT VALID a propósito: los viajes que ya existen no se reescriben aquí —cuál
 * era su fin real no lo sabe una migración—, pero cualquier escritura nueva
 * sobre ellos tendrá que dejar un periodo con duración. Un viaje sin fecha de
 * fin tiene un rango abierto, que no está vacío, y sigue valiendo.
 */
export class PeriodoDeViajeNoVacio1805000000000 implements MigrationInterface {
  name = 'PeriodoDeViajeNoVacio1805000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE viajes ADD CONSTRAINT ck_viajes_periodo_no_vacio
        CHECK (NOT isempty(periodo)) NOT VALID`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE viajes DROP CONSTRAINT ck_viajes_periodo_no_vacio`);
  }
}
