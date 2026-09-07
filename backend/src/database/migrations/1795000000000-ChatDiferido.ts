import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * §2C · El chat queda DIFERIDO, y se retira su columna.
 *
 * LA DECISIÓN
 *
 * Tomada el 2026-09-07, después de construir `solicitudes_ruta`. El panel v1
 * sale SIN chat, y la elección entre integrar una mensajería existente y
 * construir una propia se pospone hasta que exista la app del conductor (2A) y
 * se sepa qué hay que decirle de verdad.
 *
 * POR QUÉ SE RETIRA LA COLUMNA EN VEZ DE DEJARLA ESPERANDO
 *
 * Porque su significado depende de la decisión que no se ha tomado. Con una
 * mensajería externa, `canal_chat` sería un teléfono o un enlace; con una
 * propia, el identificador interno de un hilo. No son el mismo dato con dos
 * nombres: son dos datos distintos en la misma casilla.
 *
 * Y una columna así no se queda vacía: alguien la rellena. Si media flota
 * apunta ahí números de WhatsApp durante seis meses y después se elige la
 * mensajería propia, ese contenido no se migra, se tira — y hasta que alguien
 * lo note, el panel estará mostrando un canal que no lleva a ninguna parte.
 *
 * El plan lo dice para el spec y vale igual para el esquema: lo diferido se
 * marca como diferido, no se deja dibujado.
 *
 * Cuando la decisión se tome, la columna vuelve con el significado que esa
 * decisión le dé. Recrearla cuesta una migración; desenredar datos con dos
 * significados cuesta bastante más.
 */
export class ChatDiferido1795000000000 implements MigrationInterface {
  name = 'ChatDiferido1795000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE conductores DROP COLUMN IF EXISTS canal_chat`);
  }

  /**
   * Volver atrás la recrea vacía, y es lo correcto: lo que hubiera dentro tenía
   * el significado de una decisión que no se llegó a tomar.
   */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE conductores ADD COLUMN IF NOT EXISTS canal_chat varchar(200)`);
  }
}
