import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * §7.15 `eventos_viaje` — «será la base de la trazabilidad».
 *
 * De aquí cuelgan la app del conductor (2A), la ingesta GPS (2B) y el panel de
 * tracking: todos necesitan un sitio donde decir «esto pasó, aquí, a esta hora
 * y lo dijo este». Se construye ahora porque el §7.15 lo fija entero y porque
 * un registro de trazabilidad añadido tarde nace con un hueco: los meses en los
 * que el sistema ya operaba y no registraba nada.
 *
 * APPEND-ONLY, Y LA CORRECCIÓN COMO EVENTO
 *
 * El §7.15 es explícito: «los eventos críticos no deberán eliminarse; solamente
 * podrán anularse mediante un registro de corrección auditado». Así que el rol
 * de aplicación pierde UPDATE sobre esta tabla —igual que sobre `auditoria`— y
 * anular es INSERTAR un evento de tipo `correccion` que apunta al anulado. El
 * anulado se queda: una traza en la que las cosas desaparecen no es una traza.
 *
 * LA CADENA DE HASHES
 *
 * `hash_evento` es «integridad del registro» en el §7.15, y aquí se implementa
 * como CADENA: cada hash incluye el del evento anterior del mismo viaje. Un
 * hash por fila sólo detecta que ESA fila cambió; encadenarlos detecta también
 * que se borró una del medio o que se reordenaron, que es lo que de verdad
 * tiene interés en una traza.
 *
 * `uq_eventos_encadenado` es lo que la mantiene lineal: dos eventos que digan
 * venir del mismo anterior no pueden coexistir, así que dos inserciones
 * simultáneas sobre el mismo viaje no pueden bifurcar la cadena — la segunda
 * choca y reintenta. Sin esa restricción la carrera produciría dos ramas, las
 * dos con hashes válidos.
 */
export class EventosViaje1799000000000 implements MigrationInterface {
  name = 'EventosViaje1799000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE eventos_viaje (
        evento_id        bigserial PRIMARY KEY,
        empresa_id       bigint NOT NULL REFERENCES empresas(empresa_id),
        viaje_id         bigint NOT NULL REFERENCES viajes(viaje_id),

        tipo_evento      varchar(20) NOT NULL,
        fecha_hora       timestamptz NOT NULL DEFAULT now(),
        latitud          numeric(10,7),
        longitud         numeric(10,7),
        velocidad        numeric(6,2),
        odometro         numeric(12,2),

        usuario_id       bigint REFERENCES usuarios(usuario_id),
        dispositivo_id   bigint REFERENCES dispositivos(dispositivo_id),
        origen_dato      varchar(10) NOT NULL,
        observacion      text,
        evidencia        varchar(300),

        -- La corrección del §7.15: anula sin borrar, y dice por qué.
        anula_evento_id  bigint REFERENCES eventos_viaje(evento_id),

        hash_anterior    char(64),
        hash_evento      char(64) NOT NULL,
        creado_en        timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT ck_eventos_tipo CHECK (tipo_evento IN (
          'salida','llegada','carga','parada','entrega','incidente','correccion')),
        CONSTRAINT ck_eventos_origen CHECK (
          origen_dato IN ('gps','movil','web','sensor','api')),
        CONSTRAINT ck_eventos_geo CHECK (
          (latitud IS NULL AND longitud IS NULL)
          OR (latitud BETWEEN -90 AND 90 AND longitud BETWEEN -180 AND 180)),
        CONSTRAINT ck_eventos_velocidad CHECK (velocidad IS NULL OR velocidad >= 0),
        -- Una corrección apunta a lo que anula y explica por qué; y sólo una
        -- corrección puede apuntar a nada.
        CONSTRAINT ck_eventos_correccion CHECK (
          (tipo_evento = 'correccion'
             AND anula_evento_id IS NOT NULL
             AND length(btrim(coalesce(observacion, ''))) >= 5)
          OR (tipo_evento <> 'correccion' AND anula_evento_id IS NULL)),
        -- El eslabón: dos eventos no pueden decir que vienen del mismo
        -- anterior. Es lo que impide que una carrera bifurque la cadena.
        --
        -- NULLS NOT DISTINCT no es adorno: por omisión Postgres considera que
        -- dos NULL son distintos, así que sin esto el evento GÉNESIS —el único
        -- con hash_anterior nulo— quedaba fuera de la protección y dos
        -- primeros eventos simultáneos del mismo viaje podían coexistir. La
        -- cadena se bifurcaba justo en la raíz, que es donde menos se nota.
        -- Lo encontró la prueba que intentaba bifurcarla y no lo consiguió.
        CONSTRAINT uq_eventos_encadenado UNIQUE NULLS NOT DISTINCT (viaje_id, hash_anterior),
        CONSTRAINT uq_eventos_hash UNIQUE (hash_evento)
      )`);

    await q.query(
      `CREATE INDEX ix_eventos_viaje ON eventos_viaje (empresa_id, viaje_id, evento_id)`);
    await q.query(
      `CREATE INDEX ix_eventos_tipo ON eventos_viaje (empresa_id, tipo_evento, fecha_hora DESC)`);

    await q.query(`ALTER TABLE eventos_viaje ENABLE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY aislamiento_empresa ON eventos_viaje
        USING (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)
        WITH CHECK (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)`);

    const usuarioApp = process.env.DATABASE_APP_USER || 'fleetfuel_app';
    await q.query(`GRANT SELECT, INSERT ON eventos_viaje TO ${usuarioApp}`);
    // Sin UPDATE, como `auditoria`: si se pudiera reescribir un evento, la
    // cadena de hashes se podría recalcular entera y no probaría nada.
    await q.query(`REVOKE UPDATE ON eventos_viaje FROM ${usuarioApp}`);
    await q.query(
      `GRANT USAGE, SELECT ON SEQUENCE eventos_viaje_evento_id_seq TO ${usuarioApp}`);

    const PERMISOS: Array<[string, string]> = [
      ['eventos:leer', 'Ver la traza de eventos de un viaje'],
      ['eventos:crear', 'Registrar un evento de viaje'],
      ['eventos:anular', 'Anular un evento con un registro de corrección'],
    ];
    for (const [codigo, descripcion] of PERMISOS) {
      await q.query(
        `INSERT INTO permisos (codigo, modulo, descripcion) VALUES ($1,'eventos',$2)
           ON CONFLICT (codigo) DO NOTHING`, [codigo, descripcion]);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM roles_permisos WHERE permiso_id IN
                     (SELECT permiso_id FROM permisos WHERE modulo = 'eventos')`);
    await q.query(`DELETE FROM permisos WHERE modulo = 'eventos'`);
    await q.query(`DROP TABLE IF EXISTS eventos_viaje`);
  }
}
