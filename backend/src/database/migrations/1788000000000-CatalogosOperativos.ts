import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 1A · Catálogos, flota y conductores (§7.1 – §7.7 del PRD).
 *
 * Siete tablas de catálogo, todas con `empresa_id` y RLS desde el minuto cero,
 * igual que la migración base: añadir el aislamiento después obliga a migrar
 * los datos y auditar cada consulta ya escrita.
 *
 * Las unicidades van SIEMPRE compuestas con `empresa_id`. Un RUC o una placa
 * son únicos dentro de una operadora, no en todo el sistema: si la unicidad
 * fuera global, dos empresas distintas no podrían registrar al mismo cliente
 * —cosa perfectamente normal— y una podría deducir la cartera de la otra por
 * el error de clave duplicada, que es una fuga de información entre inquilinos.
 */
export class CatalogosOperativos1788000000000 implements MigrationInterface {
  name = 'CatalogosOperativos1788000000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── §7.1 clientes ───────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE clientes (
        cliente_id     bigserial PRIMARY KEY,
        empresa_id     bigint NOT NULL REFERENCES empresas(empresa_id),
        nombre         varchar(160) NOT NULL,
        razon_social   varchar(200),
        ruc            varchar(40),
        contacto       varchar(160),
        telefono       varchar(40),
        correo         varchar(160),
        estado         varchar(20) NOT NULL DEFAULT 'activo',
        creado_en      timestamptz NOT NULL DEFAULT now(),
        actualizado_en timestamptz NOT NULL DEFAULT now(),
        eliminado_en   timestamptz,
        CONSTRAINT ck_clientes_estado CHECK (estado IN ('activo','inactivo')),
        CONSTRAINT uq_clientes_empresa_ruc UNIQUE (empresa_id, ruc)
      )`);

    // ── §7.2 estaciones_servicio ────────────────────────────────────────────
    await q.query(`
      CREATE TABLE estaciones_servicio (
        estacion_id        bigserial PRIMARY KEY,
        empresa_id         bigint NOT NULL REFERENCES empresas(empresa_id),
        cliente_id         bigint NOT NULL REFERENCES clientes(cliente_id),
        nombre             varchar(160) NOT NULL,
        codigo_externo     varchar(60),
        provincia          varchar(80),
        distrito           varchar(80),
        corregimiento      varchar(80),
        direccion          varchar(300),
        -- geography y no dos numeric sueltos: las consultas de la Fase 2
        -- —geocercas, «estaciones a menos de N km»— son de distancia sobre la
        -- superficie terrestre, y con columnas planas cada una tendría que
        -- reimplementar Haversine a mano.
        ubicacion          geography(Point, 4326),
        horario_recepcion  varchar(120),
        contacto_recepcion varchar(160),
        capacidad_total    numeric(12,2),
        estado             varchar(20) NOT NULL DEFAULT 'activa',
        creado_en          timestamptz NOT NULL DEFAULT now(),
        actualizado_en     timestamptz NOT NULL DEFAULT now(),
        eliminado_en       timestamptz,
        CONSTRAINT ck_estaciones_estado CHECK (estado IN ('activa','inactiva')),
        CONSTRAINT ck_estaciones_capacidad CHECK (capacidad_total IS NULL OR capacidad_total > 0),
        CONSTRAINT uq_estaciones_empresa_codigo UNIQUE (empresa_id, codigo_externo)
      )`);
    await q.query(`CREATE INDEX ix_estaciones_cliente ON estaciones_servicio (empresa_id, cliente_id)`);
    await q.query(`CREATE INDEX ix_estaciones_ubicacion ON estaciones_servicio USING gist (ubicacion)`);

    // ── §7.3 productos_combustible ──────────────────────────────────────────
    await q.query(`
      CREATE TABLE productos_combustible (
        producto_id          bigserial PRIMARY KEY,
        empresa_id           bigint NOT NULL REFERENCES empresas(empresa_id),
        codigo               varchar(40) NOT NULL,
        nombre               varchar(120) NOT NULL,
        unidad_medida        varchar(20) NOT NULL DEFAULT 'litros',
        densidad_referencia  numeric(8,4),
        tolerancia_merma     numeric(5,2) NOT NULL DEFAULT 0,
        requiere_temperatura boolean NOT NULL DEFAULT false,
        color_identificacion varchar(20),
        estado               varchar(20) NOT NULL DEFAULT 'activo',
        creado_en            timestamptz NOT NULL DEFAULT now(),
        actualizado_en       timestamptz NOT NULL DEFAULT now(),
        eliminado_en         timestamptz,
        CONSTRAINT ck_productos_estado CHECK (estado IN ('activo','inactivo')),
        CONSTRAINT ck_productos_unidad CHECK (unidad_medida IN ('litros','galones')),
        -- La merma es un porcentaje: fuera de 0-100 no significa nada, y un
        -- valor absurdo aquí se propaga silenciosamente a las liquidaciones.
        CONSTRAINT ck_productos_merma CHECK (tolerancia_merma >= 0 AND tolerancia_merma <= 100),
        CONSTRAINT uq_productos_empresa_codigo UNIQUE (empresa_id, codigo)
      )`);

    // ── §7.4 vehiculos ──────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE vehiculos (
        vehiculo_id                 bigserial PRIMARY KEY,
        empresa_id                  bigint NOT NULL REFERENCES empresas(empresa_id),
        tipo_vehiculo               varchar(20) NOT NULL,
        placa                       varchar(20) NOT NULL,
        numero_flota                varchar(40),
        marca                       varchar(80),
        modelo                      varchar(80),
        anio                        smallint,
        vin                         varchar(40),
        capacidad_combustible_motor numeric(10,2),
        odometro_actual             numeric(12,2) NOT NULL DEFAULT 0,
        estado_operativo            varchar(20) NOT NULL DEFAULT 'disponible',
        gps_id                      varchar(80),
        fecha_seguro                date,
        fecha_revision              date,
        propietario                 varchar(20) NOT NULL DEFAULT 'propio',
        costo_depreciacion_km       numeric(10,4),
        costo_mantenimiento_km      numeric(10,4),
        creado_en                   timestamptz NOT NULL DEFAULT now(),
        actualizado_en              timestamptz NOT NULL DEFAULT now(),
        eliminado_en                timestamptz,
        CONSTRAINT ck_vehiculos_tipo CHECK (tipo_vehiculo IN ('cabezal','cisterna','integrada')),
        CONSTRAINT ck_vehiculos_estado CHECK (estado_operativo IN ('disponible','en_viaje','mantenimiento','bloqueado')),
        CONSTRAINT ck_vehiculos_propietario CHECK (propietario IN ('propio','tercero')),
        CONSTRAINT ck_vehiculos_odometro CHECK (odometro_actual >= 0),
        CONSTRAINT uq_vehiculos_empresa_placa UNIQUE (empresa_id, placa)
      )`);
    await q.query(`CREATE INDEX ix_vehiculos_estado ON vehiculos (empresa_id, estado_operativo)`);

    // ── §7.5 cisternas ──────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE cisternas (
        cisterna_id               bigserial PRIMARY KEY,
        empresa_id                bigint NOT NULL REFERENCES empresas(empresa_id),
        vehiculo_id               bigint NOT NULL REFERENCES vehiculos(vehiculo_id),
        capacidad_total           numeric(12,2) NOT NULL,
        cantidad_compartimentos   smallint NOT NULL DEFAULT 1,
        certificado_calibracion   varchar(120),
        fecha_calibracion         date,
        fecha_proxima_calibracion date,
        material                  varchar(60),
        estado_limpieza           varchar(20) NOT NULL DEFAULT 'limpia',
        producto_anterior         bigint REFERENCES productos_combustible(producto_id),
        estado                    varchar(20) NOT NULL DEFAULT 'disponible',
        creado_en                 timestamptz NOT NULL DEFAULT now(),
        actualizado_en            timestamptz NOT NULL DEFAULT now(),
        eliminado_en              timestamptz,
        CONSTRAINT ck_cisternas_limpieza CHECK (estado_limpieza IN ('limpia','pendiente','bloqueada')),
        CONSTRAINT ck_cisternas_estado CHECK (estado IN ('disponible','cargada','en_viaje','mantenimiento')),
        CONSTRAINT ck_cisternas_capacidad CHECK (capacidad_total > 0),
        CONSTRAINT ck_cisternas_compartimentos CHECK (cantidad_compartimentos BETWEEN 1 AND 12),
        -- La próxima calibración no puede ser anterior a la última: invertirlas
        -- haría que una cisterna vencida pareciera vigente.
        CONSTRAINT ck_cisternas_calibracion CHECK (
          fecha_proxima_calibracion IS NULL OR fecha_calibracion IS NULL
          OR fecha_proxima_calibracion >= fecha_calibracion)
      )`);
    await q.query(`
      CREATE UNIQUE INDEX uq_cisternas_vehiculo_viva
        ON cisternas (empresa_id, vehiculo_id) WHERE eliminado_en IS NULL`);

    // ── §7.6 compartimentos_cisterna ────────────────────────────────────────
    await q.query(`
      CREATE TABLE compartimentos_cisterna (
        compartimento_id      bigserial PRIMARY KEY,
        empresa_id            bigint NOT NULL REFERENCES empresas(empresa_id),
        cisterna_id           bigint NOT NULL REFERENCES cisternas(cisterna_id) ON DELETE CASCADE,
        numero                smallint NOT NULL,
        capacidad_nominal     numeric(12,2) NOT NULL,
        capacidad_calibrada   numeric(12,2) NOT NULL,
        producto_permitido    bigint REFERENCES productos_combustible(producto_id),
        estado                varchar(20) NOT NULL DEFAULT 'disponible',
        fecha_ultima_limpieza date,
        observaciones         text,
        creado_en             timestamptz NOT NULL DEFAULT now(),
        actualizado_en        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_compartimentos_estado CHECK (estado IN ('disponible','ocupado','limpieza','bloqueado')),
        CONSTRAINT ck_compartimentos_numero CHECK (numero >= 1),
        CONSTRAINT ck_compartimentos_capacidades CHECK (
          capacidad_nominal > 0 AND capacidad_calibrada > 0
          -- §7.6: el plan de carga se valida contra la capacidad CALIBRADA,
          -- que es la certificada. Nunca puede exceder la nominal: si lo
          -- hiciera, se podría planificar más volumen del que cabe.
          AND capacidad_calibrada <= capacidad_nominal),
        CONSTRAINT uq_compartimentos_cisterna_numero UNIQUE (cisterna_id, numero)
      )`);
    await q.query(`CREATE INDEX ix_compartimentos_cisterna ON compartimentos_cisterna (empresa_id, cisterna_id)`);

    // ── §7.7 conductores ────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE conductores (
        conductor_id                bigserial PRIMARY KEY,
        empresa_id                  bigint NOT NULL REFERENCES empresas(empresa_id),
        usuario_id                  bigint REFERENCES usuarios(usuario_id),
        nombre_completo             varchar(200) NOT NULL,
        documento                   varchar(40) NOT NULL,
        licencia                    varchar(40) NOT NULL,
        categoria                   varchar(20),
        fecha_vencimiento_licencia  date,
        telefono                    varchar(40),
        correo                      varchar(160),
        estado                      varchar(20) NOT NULL DEFAULT 'disponible',
        tarifa_base                 numeric(12,2),
        tarifa_km                   numeric(10,4),
        tarifa_viaje                numeric(12,2),
        tarifa_entrega              numeric(12,2),
        -- Cifrada, como la cedula en la tabla usuarios: es dato bancario de una
        -- persona, no del negocio.
        cuenta_bancaria_cifrada     bytea,
        contacto_emergencia         varchar(200),
        creado_en                   timestamptz NOT NULL DEFAULT now(),
        actualizado_en              timestamptz NOT NULL DEFAULT now(),
        eliminado_en                timestamptz,
        CONSTRAINT ck_conductores_estado CHECK (estado IN ('disponible','en_viaje','descanso','suspendido')),
        CONSTRAINT ck_conductores_tarifas CHECK (
          (tarifa_base    IS NULL OR tarifa_base    >= 0) AND
          (tarifa_km      IS NULL OR tarifa_km      >= 0) AND
          (tarifa_viaje   IS NULL OR tarifa_viaje   >= 0) AND
          (tarifa_entrega IS NULL OR tarifa_entrega >= 0)),
        CONSTRAINT uq_conductores_empresa_documento UNIQUE (empresa_id, documento),
        CONSTRAINT uq_conductores_empresa_licencia UNIQUE (empresa_id, licencia)
      )`);
    await q.query(`CREATE INDEX ix_conductores_estado ON conductores (empresa_id, estado)`);
    await q.query(`
      CREATE INDEX ix_conductores_licencia_vence
        ON conductores (empresa_id, fecha_vencimiento_licencia)
        WHERE eliminado_en IS NULL`);

    // ── RLS · idéntica a la migración base ──────────────────────────────────
    for (const [tabla] of TABLAS) {
      await q.query(`ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY`);
      await q.query(`
        CREATE POLICY aislamiento_empresa ON ${tabla}
          USING (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)
          WITH CHECK (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)`);
    }

    // ── Privilegios del rol de aplicación ───────────────────────────────────
    const usuarioApp = process.env.DATABASE_APP_USER || 'fleetfuel_app';
    for (const [tabla] of TABLAS) {
      // Sin DELETE (§7, regla 14): los catálogos se dan de baja con
      // `eliminado_en`, no se borran. Un borrado real dejaría huérfanas las
      // órdenes y los viajes históricos que los referencian.
      await q.query(`GRANT SELECT, INSERT, UPDATE ON ${tabla} TO ${usuarioApp}`);
    }

    // El nombre de la secuencia de un bigserial es `<tabla>_<columna>_seq`, no
    // `<singular>_id_seq`. Se pregunta con pg_get_serial_sequence en vez de
    // construirlo: adivinarlo mal aborta la transacción entera, y un .catch()
    // de JavaScript NO lo rescata —se traga el rechazo, pero Postgres ya marcó
    // la transacción como fallida y todo lo que sigue cae con 25P02.
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

    // ── Permisos de negocio (§5) ────────────────────────────────────────────
    // Se sigue la convención ya establecida en la migración base:
    // `modulo:verbo` con dos puntos, y los verbos leer/crear/actualizar. No se
    // inventa una segunda gramática de permisos: dos convenciones conviviendo
    // en la misma tabla hacen que ninguna consulta por prefijo sea fiable.
    const ACCIONES: Array<[string, string]> = [
      ['leer',        'Ver'],
      ['crear',       'Crear'],
      ['actualizar',  'Modificar'],
      ['desactivar',  'Dar de baja'],
    ];
    for (const [modulo, etiqueta] of RECURSOS) {
      for (const [verbo, descripcion] of ACCIONES) {
        await q.query(
          `INSERT INTO permisos (codigo, modulo, descripcion) VALUES ($1, $2, $3)
             ON CONFLICT (codigo) DO NOTHING`,
          [`${modulo}:${verbo}`, modulo, `${descripcion} ${etiqueta}`],
        );
      }
    }

    // ── Asignación a los 12 roles del §5 ────────────────────────────────────
    // Crear los permisos no basta: un permiso que ningún rol tiene es un
    // endpoint que nadie puede llamar. Se reparten por responsabilidad, no
    // dando todo a todos: el riesgo principal del sistema es el fraude
    // interno (§7), y un rol con más permisos de los que su trabajo requiere
    // es precisamente la superficie que hay que evitar.
    for (const [rol, codigos] of Object.entries(REPARTO)) {
      for (const codigo of codigos) {
        await q.query(
          `INSERT INTO roles_permisos (rol_id, permiso_id)
             SELECT r.rol_id, p.permiso_id
               FROM roles r, permisos p
              WHERE r.nombre = $1 AND p.codigo = $2
             ON CONFLICT DO NOTHING`,
          [rol, codigo],
        );
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM permisos WHERE codigo LIKE ANY($1)`,
      [RECURSOS.map(([modulo]) => `${modulo}:%`)]);
    // Orden inverso al de creación: las claves foráneas no admiten otro.
    for (const [tabla] of [...TABLAS].reverse()) {
      await q.query(`DROP TABLE IF EXISTS ${tabla} CASCADE`);
    }
  }
}

/**
 * Orden de creación —cada tabla solo referencia a las anteriores— con su
 * columna de clave primaria, que hace falta para localizar la secuencia.
 */
const TODOS = (m: string) => [`${m}:leer`, `${m}:crear`, `${m}:actualizar`, `${m}:desactivar`];
const SOLO_LECTURA = ['clientes:leer', 'estaciones:leer', 'productos:leer',
                      'vehiculos:leer', 'cisternas:leer', 'conductores:leer'];

/**
 * Reparto de los permisos de 1A entre los 12 roles del §5.
 *
 * «Cliente externo» y «Conductor» no reciben ninguno a propósito: el primero
 * ve solo sus propias órdenes (Fase 1B) y el segundo trabaja desde la app
 * móvil contra endpoints de viaje, no contra los catálogos.
 */
const REPARTO: Record<string, string[]> = {
  'Administrador': [...TODOS('clientes'), ...TODOS('estaciones'), ...TODOS('productos'),
                    ...TODOS('vehiculos'), ...TODOS('cisternas'), ...TODOS('conductores')],
  'Supervisor de operaciones': [...SOLO_LECTURA, 'vehiculos:actualizar', 'cisternas:actualizar',
                                'conductores:actualizar'],
  'Planificador de flota': [...SOLO_LECTURA, ...TODOS('vehiculos'), ...TODOS('cisternas')],
  'Despachador': SOLO_LECTURA,
  'Operador de órdenes': ['clientes:leer', 'clientes:crear', 'clientes:actualizar',
                          'estaciones:leer', 'estaciones:crear', 'estaciones:actualizar',
                          'productos:leer'],
  'Mantenimiento': ['vehiculos:leer', 'vehiculos:actualizar', 'cisternas:leer', 'cisternas:actualizar'],
  // El auditor lee todo y no modifica nada: si pudiera escribir, dejaría de
  // ser independiente de lo que audita.
  'Auditor': SOLO_LECTURA,
  'Responsable de estación': ['estaciones:leer', 'productos:leer'],
  'Operador de carga': ['cisternas:leer', 'productos:leer', 'conductores:leer'],
  // Finanzas ve conductores por las tarifas que alimentan las liquidaciones.
  'Finanzas': ['clientes:leer', 'conductores:leer'],
  'Cliente externo': [],
  'Conductor': [],
};

/** Módulos de permiso que introduce 1A, con su etiqueta para la descripción. */
const RECURSOS: Array<[string, string]> = [
  ['clientes',    'clientes'],
  ['estaciones',  'estaciones de servicio'],
  ['productos',   'productos de combustible'],
  ['vehiculos',   'vehículos'],
  ['cisternas',   'cisternas y compartimentos'],
  ['conductores', 'conductores'],
];

const TABLAS = [
  ['clientes',                'cliente_id'],
  ['estaciones_servicio',     'estacion_id'],
  ['productos_combustible',   'producto_id'],
  ['vehiculos',               'vehiculo_id'],
  ['cisternas',               'cisterna_id'],
  ['compartimentos_cisterna', 'compartimento_id'],
  ['conductores',             'conductor_id'],
] as const;
