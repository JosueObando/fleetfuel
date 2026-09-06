import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La unicidad de los catálogos pasa a ignorar las bajas lógicas.
 *
 * EL DESAJUSTE
 *
 * Los servicios comprueban la unicidad con `... AND eliminado_en IS NULL`: su
 * intención declarada es que dar de baja un cliente LIBERE su RUC. Los índices
 * no llevaban esa condición, así que la base seguía reservándolo para siempre.
 *
 * Las dos reglas no sólo discrepaban: discrepaban en la dirección que rompe. El
 * servicio dejaba pasar el alta —su comprobación no veía al cliente dado de
 * baja— y el INSERT chocaba después contra el índice. Y como en los catálogos
 * nadie traduce el 23505, el error de Postgres salía tal cual.
 *
 * Verificado por HTTP antes de arreglarlo: reusar el RUC de un cliente dado de
 * baja devolvía **500 «Internal server error»**. Ni el 201 que el servicio
 * creía estar permitiendo, ni el 409 que su propio comentario prometía.
 *
 * POR QUÉ PARCIALES Y NO AL REVÉS
 *
 * Se podría haber quitado el `eliminado_en IS NULL` de los servicios y dejar la
 * reserva perpetua. Se elige lo contrario por tres razones: es lo que los seis
 * servicios ya declaran querer; es el patrón que este mismo esquema YA aplica
 * en `uq_cisternas_vehiculo_viva` y `uq_usuarios_correo_global`, así que la
 * excepción eran estos índices y no los otros; y una reserva perpetua convierte
 * una baja por error en un problema que sólo se arregla tocando la base a mano.
 *
 * `uq_usuarios_empresa_correo` entra aquí aunque `usuarios` no sea un catálogo:
 * es exactamente el mismo desajuste —el índice global de correo SÍ era parcial
 * y este no—, encontrado por el mismo camino.
 *
 * DE DÓNDE SALIÓ LA DIVERGENCIA
 *
 * No fue descuido. En PostgreSQL una `UNIQUE constraint` **no puede ser
 * parcial**: sólo un `UNIQUE INDEX` admite `WHERE`. Por eso los dos que sí
 * ignoraban las bajas están declarados como índices y estos seis como
 * constraints — y la semántica se separó con el mecanismo, sin que nada lo
 * señalara. Por eso esta migración quita la CONSTRAINT y pone un ÍNDICE: no es
 * un cambio de estilo, es la única forma de expresar esta regla.
 *
 * EL EFECTO COLATERAL QUE HAY QUE CONOCER
 *
 * Un índice parcial **no sirve de árbitro de `ON CONFLICT`** salvo que la
 * sentencia repita su condición. Cualquier
 * `ON CONFLICT (empresa_id, correo) DO …` que antes funcionaba empieza a
 * responder «there is no unique or exclusion constraint matching the ON
 * CONFLICT specification» — y no es un aviso, es un fallo duro.
 *
 * Aquí afectó a `seeds/seed.ts`, que es como se crea el administrador inicial:
 * la semilla dejó de funcionar entera. Se arregla añadiendo el predicado
 * (`ON CONFLICT (…) WHERE eliminado_en IS NULL DO …`). Si mañana alguien
 * escribe un upsert nuevo contra una de estas siete tablas, tendrá que hacer lo
 * mismo.
 */
const INDICES: Array<[nombre: string, tabla: string, columnas: string]> = [
  ['uq_clientes_empresa_ruc',           'clientes',              'empresa_id, ruc'],
  ['uq_vehiculos_empresa_placa',        'vehiculos',             'empresa_id, placa'],
  ['uq_conductores_empresa_documento',  'conductores',           'empresa_id, documento'],
  ['uq_conductores_empresa_licencia',   'conductores',           'empresa_id, licencia'],
  ['uq_estaciones_empresa_codigo',      'estaciones_servicio',   'empresa_id, codigo_externo'],
  ['uq_productos_empresa_codigo',       'productos_combustible', 'empresa_id, codigo'],
  ['uq_usuarios_empresa_correo',        'usuarios',              'empresa_id, correo'],
];

export class UnicidadIgnoraBajas1791000000000 implements MigrationInterface {
  name = 'UnicidadIgnoraBajas1791000000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const [nombre, tabla, columnas] of INDICES) {
      // Primero como constraint —que es como están hoy— y luego como índice, por
      // si alguna ya se hubiera migrado a mano.
      await q.query(`ALTER TABLE ${tabla} DROP CONSTRAINT IF EXISTS ${nombre}`);
      await q.query(`DROP INDEX IF EXISTS ${nombre}`);
      await q.query(
        `CREATE UNIQUE INDEX ${nombre} ON ${tabla} (${columnas}) WHERE eliminado_en IS NULL`);
    }
  }

  /**
   * Volver atrás PUEDE FALLAR, y es correcto que falle.
   *
   * En cuanto alguien aproveche la libertad nueva —dar de baja un cliente y
   * registrar otro con el mismo RUC— habrá dos filas con el mismo par, y un
   * índice sin la condición no se puede crear sobre ellas. Revertir exigiría
   * decidir qué se hace con esas filas, y esa decisión no la puede tomar una
   * migración en silencio.
   *
   * Y si se revierte, hay que deshacer también el `WHERE eliminado_en IS NULL`
   * del `ON CONFLICT` de la semilla: con la constraint de vuelta, el predicado
   * sobra y Postgres vuelve a rechazarlo. Van juntos en las dos direcciones.
   */
  public async down(q: QueryRunner): Promise<void> {
    for (const [nombre, tabla, columnas] of INDICES) {
      await q.query(`DROP INDEX IF EXISTS ${nombre}`);
      await q.query(`ALTER TABLE ${tabla} ADD CONSTRAINT ${nombre} UNIQUE (${columnas})`);
    }
  }
}
