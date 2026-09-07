import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El identificador de CLIENTE en los eventos: lo que hace idempotente la cola
 * de salida de la app del conductor (2A).
 *
 * EL PROBLEMA QUE RESUELVE
 *
 * La app registra sin cobertura en su SQLite y sincroniza cuando vuelve la
 * senal. Si el lote llega al servidor y la respuesta se pierde por el camino
 * —tunel, cambio de celda, bateria—, la app no sabe si aterrizo y vuelve a
 * mandarlo. Sin nada que lo distinga, el viaje acaba con la salida registrada
 * tres veces.
 *
 * La idempotencia del ADR 004 protege la PETICION entera con su
 * `Idempotency-Key`, y eso no basta aqui: el reintento de una cola no suele ser
 * la misma peticion. Traera los tres que no confirmaron mas los cinco nuevos
 * que se acumularon mientras tanto, o sea un lote distinto que repite parte del
 * anterior. Lo que hay que reconocer no es la peticion: es CADA elemento.
 *
 * Por eso el identificador lo genera el DISPOSITIVO y no el servidor. Es la
 * unica forma de que sobreviva a un reintento: un id del servidor no existe
 * todavia cuando la app necesita recordar que ya mando esa fila.
 *
 * Es UNICO POR EMPRESA y no global: dos dispositivos de operadoras distintas
 * pueden generar el mismo UUID —improbable, pero no imposible, y menos con
 * generadores flojos en moviles baratos— y eso no debe hacer que uno vea
 * rechazado su evento por culpa del otro.
 */
export class IdClienteEnEventos1800000000000 implements MigrationInterface {
  name = 'IdClienteEnEventos1800000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE eventos_viaje ADD COLUMN id_cliente uuid`);
    // Parcial: los eventos creados desde la web no traen id de dispositivo, y
    // sin el WHERE todos ellos colisionarian entre si en el NULL.
    await q.query(`
      CREATE UNIQUE INDEX uq_eventos_id_cliente
        ON eventos_viaje (empresa_id, id_cliente)
        WHERE id_cliente IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS uq_eventos_id_cliente`);
    await q.query(`ALTER TABLE eventos_viaje DROP COLUMN IF EXISTS id_cliente`);
  }
}
