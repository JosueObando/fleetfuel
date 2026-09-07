import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * §22 y 2B · Geocercas y alertas automaticas.
 *
 * GEOCERCAS
 *
 * Se guardan como `geography(Polygon,4326)` SIEMPRE, aunque casi todas se
 * definan como un circulo alrededor de una estacion. Guardar centro y radio
 * obligaria a cada consulta a decidir si compara contra un circulo o contra un
 * poligono, y esa bifurcacion acaba escrita distinto en cada sitio. El servicio
 * construye el poligono con `ST_Buffer` al crearla y a partir de ahi todo el
 * sistema pregunta lo mismo: `ST_Covers(area, punto)`.
 *
 * ALERTAS: LA CLAVE DE DEDUPLICACION ES LO QUE LAS HACE UTILES
 *
 * Una alerta que se vuelve a crear en cada evaluacion no es una alerta: es
 * ruido, y el ruido se ignora. `clave_dedup` identifica el HECHO —«este viaje
 * lleva sin GPS», «esta licencia esta vencida»— y el indice unico parcial
 * impide que exista dos veces mientras siga abierta. Reevaluar mil veces
 * produce una sola fila; resolverla y que el problema vuelva produce otra, que
 * es exactamente lo que se quiere.
 *
 * El indice es PARCIAL sobre las no resueltas a proposito: el historico se
 * conserva —una alerta resuelta es la prueba de que existio el problema— y no
 * bloquea a la siguiente.
 */
export class GeocercasYAlertas1802000000000 implements MigrationInterface {
  name = 'GeocercasYAlertas1802000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE geocercas (
        geocerca_id   bigserial PRIMARY KEY,
        empresa_id    bigint NOT NULL REFERENCES empresas(empresa_id),
        nombre        varchar(160) NOT NULL,
        tipo          varchar(20) NOT NULL,
        estacion_id   bigint REFERENCES estaciones_servicio(estacion_id),
        area          geography(Polygon, 4326) NOT NULL,
        radio_m       numeric(10,2),
        activa        boolean NOT NULL DEFAULT true,
        creado_en     timestamptz NOT NULL DEFAULT now(),
        actualizado_en timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT ck_geocercas_tipo CHECK (
          tipo IN ('estacion','terminal','taller','zona_prohibida','zona_permitida')),
        CONSTRAINT uq_geocercas_nombre UNIQUE (empresa_id, nombre)
      )`);
    await q.query(`CREATE INDEX ix_geocercas_area ON geocercas USING GIST (area)`);
    await q.query(`CREATE INDEX ix_geocercas_empresa ON geocercas (empresa_id, tipo) WHERE activa`);

    await q.query(`
      CREATE TABLE alertas (
        alerta_id      bigserial PRIMARY KEY,
        empresa_id     bigint NOT NULL REFERENCES empresas(empresa_id),
        tipo           varchar(40) NOT NULL,
        severidad      varchar(10) NOT NULL DEFAULT 'media',
        titulo         varchar(300) NOT NULL,
        detalle        jsonb,

        entidad        varchar(40) NOT NULL,
        entidad_id     bigint,
        viaje_id       bigint REFERENCES viajes(viaje_id),

        -- El HECHO que la alerta describe, no la fila que la creo.
        clave_dedup    varchar(200) NOT NULL,

        estado         varchar(12) NOT NULL DEFAULT 'abierta',
        detectada_en   timestamptz NOT NULL DEFAULT now(),
        reconocida_por bigint REFERENCES usuarios(usuario_id),
        reconocida_en  timestamptz,
        resuelta_en    timestamptz,
        motivo_cierre  text,

        CONSTRAINT ck_alertas_severidad CHECK (severidad IN ('baja','media','alta','critica')),
        CONSTRAINT ck_alertas_estado CHECK (estado IN ('abierta','reconocida','resuelta')),
        CONSTRAINT ck_alertas_reconocimiento CHECK (
          (reconocida_por IS NULL) = (reconocida_en IS NULL)),
        CONSTRAINT ck_alertas_resolucion CHECK (
          (estado = 'resuelta') = (resuelta_en IS NOT NULL))
      )`);

    // Una alerta abierta por hecho. Parcial: el historico de resueltas se
    // conserva y no bloquea a la siguiente aparicion del mismo problema.
    await q.query(`
      CREATE UNIQUE INDEX uq_alertas_vivas ON alertas (empresa_id, clave_dedup)
        WHERE estado <> 'resuelta'`);
    await q.query(
      `CREATE INDEX ix_alertas_abiertas ON alertas (empresa_id, severidad, detectada_en DESC)
         WHERE estado <> 'resuelta'`);
    await q.query(`CREATE INDEX ix_alertas_viaje ON alertas (empresa_id, viaje_id)`);

    for (const tabla of ['geocercas', 'alertas']) {
      await q.query(`ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY`);
      await q.query(`
        CREATE POLICY aislamiento_empresa ON ${tabla}
          USING (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)
          WITH CHECK (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)`);
    }

    const usuarioApp = process.env.DATABASE_APP_USER || 'fleetfuel_app';
    await q.query(`GRANT SELECT, INSERT, UPDATE ON geocercas TO ${usuarioApp}`);
    await q.query(`GRANT SELECT, INSERT, UPDATE ON alertas TO ${usuarioApp}`);
    await q.query(`GRANT USAGE, SELECT ON SEQUENCE geocercas_geocerca_id_seq TO ${usuarioApp}`);
    await q.query(`GRANT USAGE, SELECT ON SEQUENCE alertas_alerta_id_seq TO ${usuarioApp}`);

    const PERMISOS: Array<[string, string, string]> = [
      ['geocercas:leer', 'geocercas', 'Ver las geocercas'],
      ['geocercas:administrar', 'geocercas', 'Crear y modificar geocercas'],
      ['alertas:leer', 'alertas', 'Ver las alertas automaticas'],
      ['alertas:evaluar', 'alertas', 'Disparar la evaluacion de alertas'],
      ['alertas:resolver', 'alertas', 'Reconocer y cerrar alertas'],
    ];
    for (const [codigo, modulo, descripcion] of PERMISOS) {
      await q.query(
        `INSERT INTO permisos (codigo, modulo, descripcion) VALUES ($1,$2,$3)
           ON CONFLICT (codigo) DO NOTHING`, [codigo, modulo, descripcion]);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM roles_permisos WHERE permiso_id IN
                     (SELECT permiso_id FROM permisos WHERE modulo IN ('geocercas','alertas'))`);
    await q.query(`DELETE FROM permisos WHERE modulo IN ('geocercas','alertas')`);
    await q.query(`DROP TABLE IF EXISTS alertas`);
    await q.query(`DROP TABLE IF EXISTS geocercas`);
  }
}
