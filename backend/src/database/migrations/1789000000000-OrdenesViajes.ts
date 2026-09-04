import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 1B · Órdenes → plan de carga → viaje (§7.8-7.12, §8 del PRD).
 *
 * Aquí se estrena `btree_gist`, que la Fase 0 dejó instalada sin usar: una
 * cisterna o un conductor no pueden estar en dos viajes que se superponen en
 * el tiempo (§5.1). Es la primera regla del sistema que NO se puede expresar
 * con UNIQUE, porque no habla de igualdad sino de solapamiento de intervalos.
 *
 * Comprobarlo en la aplicación no sirve: entre el SELECT que verifica y el
 * INSERT que reserva cabe otra petición, y el resultado —un conductor en dos
 * viajes a la vez— sólo se descubre cuando alguien mira el calendario.
 */
export class OrdenesViajes1789000000000 implements MigrationInterface {
  name = 'OrdenesViajes1789000000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── §7.8 ordenes_abastecimiento ─────────────────────────────────────────
    await q.query(`
      CREATE TABLE ordenes_abastecimiento (
        orden_id             bigserial PRIMARY KEY,
        empresa_id           bigint NOT NULL REFERENCES empresas(empresa_id),
        numero_orden_externa varchar(60),
        cliente_id           bigint NOT NULL REFERENCES clientes(cliente_id),
        estacion_id          bigint NOT NULL REFERENCES estaciones_servicio(estacion_id),
        fecha_orden          date NOT NULL DEFAULT current_date,
        fecha_requerida      date,
        ventana_inicio       timestamptz,
        ventana_fin          timestamptz,
        prioridad            varchar(10) NOT NULL DEFAULT 'normal',
        estado               varchar(20) NOT NULL DEFAULT 'recibida',
        volumen_total        numeric(12,2) NOT NULL DEFAULT 0,
        observaciones        text,
        documento_original   varchar(300),
        fuente               varchar(10) NOT NULL DEFAULT 'manual',
        creado_por           bigint REFERENCES usuarios(usuario_id),
        creado_en            timestamptz NOT NULL DEFAULT now(),
        actualizado_en       timestamptz NOT NULL DEFAULT now(),
        eliminado_en         timestamptz,
        CONSTRAINT ck_ordenes_prioridad CHECK (prioridad IN ('baja','normal','alta','urgente')),
        -- Estados del §8.1, incluidos los alternos.
        CONSTRAINT ck_ordenes_estado CHECK (estado IN (
          'recibida','validada','planificada','asignada','en_carga','cargada',
          'en_transito','entrega_parcial','entregada','conciliada','cerrada',
          'rechazada','cancelada','suspendida','con_incidencia')),
        CONSTRAINT ck_ordenes_fuente CHECK (fuente IN ('manual','api','excel','correo')),
        CONSTRAINT ck_ordenes_volumen CHECK (volumen_total >= 0),
        -- Una ventana que termina antes de empezar no es una ventana.
        CONSTRAINT ck_ordenes_ventana CHECK (
          ventana_inicio IS NULL OR ventana_fin IS NULL OR ventana_fin > ventana_inicio),
        CONSTRAINT uq_ordenes_empresa_externa UNIQUE (empresa_id, numero_orden_externa)
      )`);
    await q.query(`CREATE INDEX ix_ordenes_estado ON ordenes_abastecimiento (empresa_id, estado, fecha_requerida)`);
    await q.query(`CREATE INDEX ix_ordenes_estacion ON ordenes_abastecimiento (empresa_id, estacion_id)`);

    // ── §7.9 detalles_orden ─────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE detalles_orden (
        detalle_orden_id    bigserial PRIMARY KEY,
        empresa_id          bigint NOT NULL REFERENCES empresas(empresa_id),
        orden_id            bigint NOT NULL REFERENCES ordenes_abastecimiento(orden_id) ON DELETE CASCADE,
        producto_id         bigint NOT NULL REFERENCES productos_combustible(producto_id),
        volumen_solicitado  numeric(12,2) NOT NULL,
        volumen_planificado numeric(12,2) NOT NULL DEFAULT 0,
        volumen_entregado   numeric(12,2) NOT NULL DEFAULT 0,
        -- Calculado y almacenado: se consulta constantemente («¿qué falta por
        -- planificar?») y derivarlo en cada consulta invita a que dos sitios
        -- lo calculen distinto.
        volumen_pendiente   numeric(12,2) GENERATED ALWAYS AS
                              (volumen_solicitado - volumen_entregado) STORED,
        tolerancia          numeric(5,2) NOT NULL DEFAULT 0,
        estado              varchar(20) NOT NULL DEFAULT 'pendiente',
        creado_en           timestamptz NOT NULL DEFAULT now(),
        actualizado_en      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_detalles_estado CHECK (estado IN ('pendiente','parcial','completo')),
        CONSTRAINT ck_detalles_volumenes CHECK (
          volumen_solicitado > 0 AND volumen_planificado >= 0 AND volumen_entregado >= 0),
        CONSTRAINT ck_detalles_tolerancia CHECK (tolerancia >= 0 AND tolerancia <= 100),
        -- Un producto no se repite dentro de la misma orden: si hiciera falta
        -- más volumen, se aumenta la línea, no se añade otra.
        CONSTRAINT uq_detalles_orden_producto UNIQUE (orden_id, producto_id)
      )`);
    await q.query(`CREATE INDEX ix_detalles_orden ON detalles_orden (empresa_id, orden_id)`);

    // ── §7.10 viajes ────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE viajes (
        viaje_id              bigserial PRIMARY KEY,
        empresa_id            bigint NOT NULL REFERENCES empresas(empresa_id),
        codigo_viaje          varchar(40) NOT NULL,
        tipo_viaje            varchar(10) NOT NULL DEFAULT 'simple',
        cabezal_id            bigint REFERENCES vehiculos(vehiculo_id),
        cisterna_id           bigint REFERENCES cisternas(cisterna_id),
        conductor_id          bigint REFERENCES conductores(conductor_id),
        conductor_auxiliar_id bigint REFERENCES conductores(conductor_id),
        origen_id             bigint REFERENCES estaciones_servicio(estacion_id),
        terminal_carga_id     bigint REFERENCES estaciones_servicio(estacion_id),
        -- NOT NULL a propósito: el periodo de ocupación se calcula a partir de
        -- ella, y sin fecha el intervalo sería (,) —infinito— y chocaría con
        -- todos los demás viajes.
        fecha_programada      timestamptz NOT NULL,
        fecha_inicio          timestamptz,
        fecha_fin             timestamptz,
        odometro_inicial      numeric(12,2),
        odometro_final        numeric(12,2),
        kilometros_gps        numeric(12,2),
        kilometros_facturables numeric(12,2),
        ruta_planificada      text,
        estado                varchar(30) NOT NULL DEFAULT 'borrador',
        motivo_cancelacion    text,
        autorizado_por        bigint REFERENCES usuarios(usuario_id),
        fecha_cierre          timestamptz,
        creado_en             timestamptz NOT NULL DEFAULT now(),
        actualizado_en        timestamptz NOT NULL DEFAULT now(),

        -- Ocupación del viaje. Si aún no arrancó, cuenta la fecha programada:
        -- un viaje planificado ya reserva su cisterna y su conductor. Sin
        -- fecha_fin el intervalo queda abierto, que es justo lo correcto para
        -- un viaje en curso.
        periodo tstzrange GENERATED ALWAYS AS (
          tstzrange(coalesce(fecha_inicio, fecha_programada), fecha_fin)
        ) STORED,

        -- Estados del §8.2.
        CONSTRAINT ck_viajes_estado CHECK (estado IN (
          'borrador','programado','autorizado','desplazamiento_terminal',
          'espera_carga','cargando','cargado','transito_estacion','descargando',
          'retornando','pendiente_liquidacion','cerrado','cancelado')),
        CONSTRAINT ck_viajes_tipo CHECK (tipo_viaje IN ('simple','multiple','retorno')),
        CONSTRAINT ck_viajes_fechas CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL
                                            OR fecha_fin >= fecha_inicio),
        CONSTRAINT ck_viajes_odometro CHECK (
          odometro_final IS NULL OR odometro_inicial IS NULL OR odometro_final >= odometro_inicial),
        -- Un conductor no puede ser su propio auxiliar.
        CONSTRAINT ck_viajes_conductores CHECK (
          conductor_auxiliar_id IS NULL OR conductor_auxiliar_id <> conductor_id),
        CONSTRAINT ck_viajes_cancelacion CHECK (
          estado <> 'cancelado' OR motivo_cancelacion IS NOT NULL),
        CONSTRAINT uq_viajes_empresa_codigo UNIQUE (empresa_id, codigo_viaje)
      )`);

    // ── §5.1 · las restricciones de exclusión ───────────────────────────────
    // Aquí es donde btree_gist gana su sitio: mezcla igualdad (=) sobre bigint
    // con solapamiento (&&) sobre un rango en el MISMO índice, cosa que un
    // GiST puro no sabe hacer con enteros.
    //
    // Los viajes cerrados y cancelados quedan fuera: ya no ocupan a nadie, y
    // sin el WHERE el histórico bloquearía para siempre a cada conductor que
    // hubiera trabajado en esas fechas.
    await q.query(`
      ALTER TABLE viajes ADD CONSTRAINT ex_viajes_cisterna
        EXCLUDE USING gist (empresa_id WITH =, cisterna_id WITH =, periodo WITH &&)
        WHERE (estado NOT IN ('cerrado','cancelado'))`);
    await q.query(`
      ALTER TABLE viajes ADD CONSTRAINT ex_viajes_conductor
        EXCLUDE USING gist (empresa_id WITH =, conductor_id WITH =, periodo WITH &&)
        WHERE (estado NOT IN ('cerrado','cancelado'))`);
    await q.query(`CREATE INDEX ix_viajes_estado ON viajes (empresa_id, estado, fecha_programada)`);

    // ── §7.11 viaje_ordenes ─────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE viaje_ordenes (
        viaje_orden_id    bigserial PRIMARY KEY,
        empresa_id        bigint NOT NULL REFERENCES empresas(empresa_id),
        viaje_id          bigint NOT NULL REFERENCES viajes(viaje_id) ON DELETE CASCADE,
        orden_id          bigint NOT NULL REFERENCES ordenes_abastecimiento(orden_id),
        secuencia_entrega smallint NOT NULL,
        estado            varchar(20) NOT NULL DEFAULT 'pendiente',
        hora_estimada     timestamptz,
        hora_real         timestamptz,
        creado_en         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_viaje_ordenes_estado CHECK (estado IN ('pendiente','en_transito','entregada')),
        CONSTRAINT ck_viaje_ordenes_secuencia CHECK (secuencia_entrega >= 1),
        CONSTRAINT uq_viaje_ordenes_par UNIQUE (viaje_id, orden_id),
        -- Dos paradas no pueden compartir posición en la ruta: el conductor
        -- necesita un orden, no un empate.
        CONSTRAINT uq_viaje_ordenes_secuencia UNIQUE (viaje_id, secuencia_entrega)
      )`);
    await q.query(`CREATE INDEX ix_viaje_ordenes_orden ON viaje_ordenes (empresa_id, orden_id)`);

    // ── §7.12 plan_carga ────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE plan_carga (
        plan_carga_id       bigserial PRIMARY KEY,
        empresa_id          bigint NOT NULL REFERENCES empresas(empresa_id),
        viaje_id            bigint NOT NULL REFERENCES viajes(viaje_id) ON DELETE CASCADE,
        compartimento_id    bigint NOT NULL REFERENCES compartimentos_cisterna(compartimento_id),
        detalle_orden_id    bigint NOT NULL REFERENCES detalles_orden(detalle_orden_id),
        producto_id         bigint NOT NULL REFERENCES productos_combustible(producto_id),
        volumen_planificado numeric(12,2) NOT NULL,
        terminal_carga      varchar(160),
        estacion_destino    bigint REFERENCES estaciones_servicio(estacion_id),
        estado              varchar(20) NOT NULL DEFAULT 'planificado',
        validado_por        bigint REFERENCES usuarios(usuario_id),
        fecha_validacion    timestamptz,
        creado_en           timestamptz NOT NULL DEFAULT now(),
        actualizado_en      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_plan_estado CHECK (estado IN ('planificado','cargado','entregado')),
        CONSTRAINT ck_plan_volumen CHECK (volumen_planificado > 0),
        -- Un compartimento lleva UN producto por viaje. Mezclar dos en el
        -- mismo tanque contamina la carga; es la regla que hace que el plan
        -- de carga sea un problema de asignación y no una suma.
        CONSTRAINT uq_plan_viaje_compartimento UNIQUE (viaje_id, compartimento_id)
      )`);
    await q.query(`CREATE INDEX ix_plan_viaje ON plan_carga (empresa_id, viaje_id)`);
    await q.query(`CREATE INDEX ix_plan_detalle ON plan_carga (empresa_id, detalle_orden_id)`);

    // ── RLS ─────────────────────────────────────────────────────────────────
    for (const [tabla] of TABLAS) {
      await q.query(`ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY`);
      await q.query(`
        CREATE POLICY aislamiento_empresa ON ${tabla}
          USING (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)
          WITH CHECK (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)`);
    }

    // ── Privilegios ─────────────────────────────────────────────────────────
    const usuarioApp = process.env.DATABASE_APP_USER || 'fleetfuel_app';
    for (const [tabla] of TABLAS) {
      await q.query(`GRANT SELECT, INSERT, UPDATE ON ${tabla} TO ${usuarioApp}`);
    }
    // Las líneas de plan de carga y de detalle SÍ se borran: son piezas de un
    // borrador que se rehace, no historia. Un plan de carga mal armado se
    // corrige quitando la línea, no marcándola de baja para siempre.
    for (const tabla of ['plan_carga', 'viaje_ordenes', 'detalles_orden']) {
      await q.query(`GRANT DELETE ON ${tabla} TO ${usuarioApp}`);
    }
    for (const [tabla, columna] of TABLAS) {
      await q.query(`
        DO $$
        DECLARE secuencia text;
        BEGIN
          secuencia := pg_get_serial_sequence('${tabla}', '${columna}');
          IF secuencia IS NOT NULL THEN
            EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO %I', secuencia, '${usuarioApp}');
          END IF;
        END $$;`);
    }

    // ── Permisos (§5) ───────────────────────────────────────────────────────
    const ACCIONES: Array<[string, string]> = [
      ['leer', 'Ver'], ['crear', 'Crear'], ['actualizar', 'Modificar'], ['cancelar', 'Cancelar'],
    ];
    for (const [modulo, etiqueta] of RECURSOS) {
      for (const [verbo, descripcion] of ACCIONES) {
        await q.query(
          `INSERT INTO permisos (codigo, modulo, descripcion) VALUES ($1,$2,$3)
             ON CONFLICT (codigo) DO NOTHING`,
          [`${modulo}:${verbo}`, modulo, `${descripcion} ${etiqueta}`]);
      }
    }
    // `viajes:autorizar` es aparte: el §8.2 exige que alguien distinto del
    // planificador autorice antes de que el viaje salga.
    await q.query(
      `INSERT INTO permisos (codigo, modulo, descripcion)
       VALUES ('viajes:autorizar','viajes','Autorizar la salida de un viaje')
       ON CONFLICT (codigo) DO NOTHING`);

    for (const [rol, codigos] of Object.entries(REPARTO)) {
      for (const codigo of codigos) {
        await q.query(
          `INSERT INTO roles_permisos (rol_id, permiso_id)
             SELECT r.rol_id, p.permiso_id FROM roles r, permisos p
              WHERE r.nombre = $1 AND p.codigo = $2
             ON CONFLICT DO NOTHING`, [rol, codigo]);
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM permisos WHERE codigo LIKE ANY($1)`,
      [RECURSOS.map(([m]) => `${m}:%`)]);
    for (const [tabla] of [...TABLAS].reverse()) {
      await q.query(`DROP TABLE IF EXISTS ${tabla} CASCADE`);
    }
  }
}

const RECURSOS: Array<[string, string]> = [
  ['ordenes', 'órdenes de abastecimiento'],
  ['viajes', 'viajes'],
  ['plancarga', 'planes de carga'],
];

const TODOS = (m: string) => [`${m}:leer`, `${m}:crear`, `${m}:actualizar`, `${m}:cancelar`];
const LECTURA = ['ordenes:leer', 'viajes:leer', 'plancarga:leer'];

/**
 * La separación que importa: quien PLANIFICA no AUTORIZA.
 *
 * El riesgo principal del sistema es el fraude interno (§7), y un viaje que
 * la misma persona arma y aprueba no tiene control alguno. Por eso
 * `viajes:autorizar` solo lo tienen Supervisor y Administrador, y el
 * Planificador de flota —que crea los viajes— no lo tiene.
 */
const REPARTO: Record<string, string[]> = {
  'Administrador': [...TODOS('ordenes'), ...TODOS('viajes'), ...TODOS('plancarga'), 'viajes:autorizar'],
  'Supervisor de operaciones': [...LECTURA, 'ordenes:actualizar', 'viajes:actualizar',
                                'viajes:cancelar', 'viajes:autorizar'],
  'Planificador de flota': [...LECTURA, ...TODOS('plancarga'), 'viajes:crear', 'viajes:actualizar'],
  'Operador de órdenes': [...LECTURA, ...TODOS('ordenes')],
  'Despachador': [...LECTURA, 'viajes:actualizar'],
  'Operador de carga': [...LECTURA, 'plancarga:actualizar'],
  'Auditor': LECTURA,
  'Responsable de estación': ['ordenes:leer'],
  'Finanzas': LECTURA,
  'Conductor': ['viajes:leer'],
  'Mantenimiento': [],
  'Cliente externo': ['ordenes:leer'],
};

const TABLAS = [
  ['ordenes_abastecimiento', 'orden_id'],
  ['detalles_orden',         'detalle_orden_id'],
  ['viajes',                 'viaje_id'],
  ['viaje_ordenes',          'viaje_orden_id'],
  ['plan_carga',             'plan_carga_id'],
] as const;
