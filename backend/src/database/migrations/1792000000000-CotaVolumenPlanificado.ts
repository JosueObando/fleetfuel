import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El acumulado del plan de carga no puede pasar de lo que la orden pidió.
 *
 * EL HUECO
 *
 * `detalles_orden.volumen_planificado` es un acumulado: `agregarLineaPlan` lo
 * suma y `quitarLineaPlan` lo resta. La regla 4 del §16 lo lee para decidir si
 * cabe más carga —«a esa línea le quedan N por planificar»—, y esa era la
 * ÚNICA guardia que tenía. La `ck_detalles_volumenes` original sólo exigía
 * `volumen_planificado >= 0`: por arriba no había nada.
 *
 * Entre que la regla 4 lee el acumulado y que el servicio lo escribe no hay
 * cerrojo. Dos peticiones simultáneas sobre la misma línea leen las dos 0,
 * las dos pasan la regla con 3000 sobre una orden de 5000, y el acumulado
 * acaba en 6000. Nada lo rechazaba: la orden quedaba marcada como planificada
 * de más y la regla 4 empezaba a rechazar carga legítima, sin un solo error
 * que dijera por qué.
 *
 * POR QUÉ ESTO CIERRA LA CARRERA Y NO SÓLO LA DENUNCIA
 *
 * Es el detalle que hace que valga la pena. El servicio no escribe un total ya
 * calculado: escribe `volumen_planificado = volumen_planificado + $2`, que es
 * una lectura-modificación-escritura DENTRO de SQL. En READ COMMITTED, cuando
 * la segunda transacción se queda esperando el cerrojo de fila de la primera,
 * Postgres **reevalúa la expresión sobre la versión ya confirmada** en cuanto
 * el cerrojo se suelta. Así que la segunda suma sobre 3000, no sobre 0, y la
 * CHECK ve el total verdadero: 6000 > 5000, y la petición se cae con su
 * transacción entera —el INSERT en `plan_carga` incluido, porque cada petición
 * corre en una sola transacción con rollback—.
 *
 * Si el servicio escribiera un total precalculado, esta CHECK sólo atraparía
 * algunos casos. Como no lo hace, los atrapa todos. Quien toque ese UPDATE
 * tiene que saber que esa forma de escribirlo es parte de la garantía.
 *
 * POR QUÉ UNA CONSTRAINT NUEVA Y NO AMPLIAR `ck_detalles_volumenes`
 *
 * Porque el nombre de la restricción es lo único que llega al servicio cuando
 * salta, y es lo que le permite traducir el 23514 a un conflicto legible en
 * vez de un 500 —el mismo patrón que `traducirSolapamiento` aplica al 23P01 de
 * la exclusión del §5.1—. Metida dentro de `ck_detalles_volumenes`, el error
 * diría sólo «volumenes» y habría que adivinar cuál de las tres reglas falló.
 *
 * SI ESTA MIGRACIÓN FALLA AL APLICARSE
 *
 * Significa que YA hay líneas planificadas por encima de lo pedido, y eso es
 * exactamente lo que había que descubrir. No se arregla en silencio desde
 * aquí: decidir si sobra plan de carga o si la orden se quedó corta es una
 * decisión de operación. Para verlas:
 *
 *   SELECT detalle_orden_id, orden_id, volumen_solicitado, volumen_planificado
 *     FROM detalles_orden WHERE volumen_planificado > volumen_solicitado;
 *
 * `volumen_solicitado` no se puede editar por ninguna ruta de la API —el PATCH
 * de órdenes sólo toca fechas, prioridad y observaciones—, así que la cota no
 * puede quedar violada por encoger la línea desde la aplicación.
 */
export class CotaVolumenPlanificado1792000000000 implements MigrationInterface {
  name = 'CotaVolumenPlanificado1792000000000';

  public async up(q: QueryRunner): Promise<void> {
    // Directa y no `NOT VALID` + `VALIDATE`: la tabla se escanea entera bajo
    // ACCESS EXCLUSIVE, y a este tamaño eso es instantáneo. La versión en dos
    // pasos evita el cerrojo largo a cambio de dejar las filas viejas sin
    // comprobar, que es justo lo que aquí interesa comprobar.
    await q.query(`
      ALTER TABLE detalles_orden
        ADD CONSTRAINT ck_detalles_planificado_cabe
        CHECK (volumen_planificado <= volumen_solicitado)`);
  }

  /** Quitar una cota siempre se puede: ninguna fila estorba. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE detalles_orden DROP CONSTRAINT IF EXISTS ck_detalles_planificado_cabe`);
  }
}
