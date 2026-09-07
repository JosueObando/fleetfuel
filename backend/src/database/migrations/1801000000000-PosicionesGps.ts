import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * §5.2 y §23 · `posiciones_gps`, particionada por mes.
 *
 * POR QUE PARTICIONADA
 *
 * El §23 lo dice: «PostgreSQL con tablas particionadas» para los datos GPS. Con
 * una cadencia de 5 s por vehiculo, una flota de veinte cisternas produce del
 * orden de diez millones de filas al mes. Sin particiones, purgar el historico
 * viejo seria un DELETE que reescribe media tabla y bloquea la ingesta; con
 * ellas es un DROP de la particion del mes, instantaneo.
 *
 * La clave primaria incluye `fecha_hora` porque Postgres lo exige: la clave de
 * particion tiene que estar dentro de toda restriccion unica.
 *
 * LAS PARTICIONES SE CREAN SOLAS
 *
 * `fn_asegurar_particion_gps` es SECURITY DEFINER —igual que
 * `fn_login_resolver`— porque el rol de aplicacion no puede crear tablas y no
 * debe poder. La alternativa era una tarea programada que crease la del mes
 * siguiente, y eso falla en silencio: nadie se entera hasta que la ingesta
 * empieza a rechazar posiciones el dia 1 a las 00:00. Asi, la primera posicion
 * del mes crea su particion y sigue.
 *
 * LA UBICACION ES `geography` Y NO DOS NUMEROS
 *
 * Con dos columnas sueltas, «cuantos kilometros recorrio» se calcula a mano con
 * la formula del haversine en JavaScript, y cada sitio que lo necesite tendra
 * su propia version ligeramente distinta. Con `geography(Point,4326)`,
 * `ST_Distance` devuelve metros sobre el elipsoide y hay una sola respuesta.
 */
export class PosicionesGps1801000000000 implements MigrationInterface {
  name = 'PosicionesGps1801000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE posiciones_gps (
        posicion_id     bigserial,
        empresa_id      bigint NOT NULL REFERENCES empresas(empresa_id),
        viaje_id        bigint REFERENCES viajes(viaje_id),
        vehiculo_id     bigint NOT NULL REFERENCES vehiculos(vehiculo_id),
        dispositivo_id  bigint REFERENCES dispositivos(dispositivo_id),

        fecha_hora      timestamptz NOT NULL,
        ubicacion       geography(Point, 4326) NOT NULL,
        velocidad       numeric(6,2),
        rumbo           numeric(5,2),
        altitud         numeric(8,2),
        precision_m     numeric(8,2),
        origen          varchar(10) NOT NULL DEFAULT 'gps',
        creado_en       timestamptz NOT NULL DEFAULT now(),

        PRIMARY KEY (posicion_id, fecha_hora),
        CONSTRAINT ck_gps_velocidad CHECK (velocidad IS NULL OR velocidad >= 0),
        CONSTRAINT ck_gps_rumbo CHECK (rumbo IS NULL OR (rumbo >= 0 AND rumbo < 360)),
        CONSTRAINT ck_gps_origen CHECK (origen IN ('gps','movil','sensor','api'))
      ) PARTITION BY RANGE (fecha_hora)`);

    await q.query(`
      CREATE INDEX ix_gps_viaje ON posiciones_gps (empresa_id, viaje_id, fecha_hora DESC)`);
    await q.query(`
      CREATE INDEX ix_gps_vehiculo ON posiciones_gps (empresa_id, vehiculo_id, fecha_hora DESC)`);
    // GiST sobre la geografia: es lo que hace baratas las preguntas de
    // geocerca —«esta dentro de este poligono»— cuando lleguen.
    await q.query(`CREATE INDEX ix_gps_ubicacion ON posiciones_gps USING GIST (ubicacion)`);

    await q.query(`
      CREATE OR REPLACE FUNCTION fn_asegurar_particion_gps(momento timestamptz)
      RETURNS text
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      DECLARE
        inicio date := date_trunc('month', momento AT TIME ZONE 'UTC')::date;
        fin    date := (inicio + interval '1 month')::date;
        nombre text := 'posiciones_gps_' || to_char(inicio, 'YYYY_MM');
      BEGIN
        IF to_regclass(nombre) IS NULL THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF posiciones_gps FOR VALUES FROM (%L) TO (%L)',
            nombre, inicio, fin);
        END IF;
        RETURN nombre;
      END;
      $fn$`);

    // La del mes en curso y la del siguiente, para que el primer arranque no
    // dependa de que alguien llame a la funcion.
    await q.query(`SELECT fn_asegurar_particion_gps(now())`);
    await q.query(`SELECT fn_asegurar_particion_gps(now() + interval '1 month')`);

    await q.query(`ALTER TABLE posiciones_gps ENABLE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY aislamiento_empresa ON posiciones_gps
        USING (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)
        WITH CHECK (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)`);

    const usuarioApp = process.env.DATABASE_APP_USER || 'fleetfuel_app';
    await q.query(`GRANT SELECT, INSERT ON posiciones_gps TO ${usuarioApp}`);
    // Sin UPDATE: una posicion es una medida de un instante. Corregirla no
    // significa nada; lo que se hace es registrar otra.
    await q.query(`REVOKE UPDATE ON posiciones_gps FROM ${usuarioApp}`);
    await q.query(
      `GRANT USAGE, SELECT ON SEQUENCE posiciones_gps_posicion_id_seq TO ${usuarioApp}`);
    await q.query(
      `GRANT EXECUTE ON FUNCTION fn_asegurar_particion_gps(timestamptz) TO ${usuarioApp}`);

    const PERMISOS: Array<[string, string]> = [
      ['gps:leer', 'Ver la telemetria de un viaje'],
      ['gps:ingerir', 'Enviar posiciones GPS'],
    ];
    for (const [codigo, descripcion] of PERMISOS) {
      await q.query(
        `INSERT INTO permisos (codigo, modulo, descripcion) VALUES ($1,'gps',$2)
           ON CONFLICT (codigo) DO NOTHING`, [codigo, descripcion]);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM roles_permisos WHERE permiso_id IN
                     (SELECT permiso_id FROM permisos WHERE modulo = 'gps')`);
    await q.query(`DELETE FROM permisos WHERE modulo = 'gps'`);
    await q.query(`DROP FUNCTION IF EXISTS fn_asegurar_particion_gps(timestamptz)`);
    await q.query(`DROP TABLE IF EXISTS posiciones_gps`);
  }
}
