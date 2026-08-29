import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migración base de FleetFuel Control — Fase 0 (§19).
 *
 * Trae `empresa_id` y Row Level Security desde la primera migración (ADR 003),
 * el catálogo de permisos granulares (§7), la auditoría append-only (§21) y la
 * infraestructura de idempotencia (ADR 004). Ninguna de las cuatro se puede
 * añadir después sin migrar todas las tablas y auditar todos los endpoints.
 *
 * Separación de roles de base de datos
 * ------------------------------------
 * El dueño del esquema (DATABASE_USER) corre migraciones y seeds. La aplicación
 * se conecta con un rol distinto (DATABASE_APP_USER) que:
 *   · está sujeto a RLS — el dueño de una tabla la evade por diseño de Postgres;
 *   · no tiene DELETE sobre las tablas críticas (§7, regla 14);
 *   · no tiene UPDATE ni DELETE sobre `auditoria` (§21).
 * Se usa ENABLE y no FORCE ROW LEVEL SECURITY a propósito: el dueño necesita
 * evadirla para poder sembrar la primera empresa, que aún no tiene contexto.
 * El arranque de la aplicación verifica que no se está conectando como dueño.
 */
export class EsquemaBase1787000000000 implements MigrationInterface {
  name = 'EsquemaBase1787000000000';

  public async up(q: QueryRunner): Promise<void> {
    // Las extensiones también se crean aquí y no sólo en database/init: ese
    // script sólo corre en la primera inicialización del contenedor, y las
    // pruebas de CI levantan la base de otra forma.
    await q.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    // ── empresas ────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE empresas (
        empresa_id    bigserial PRIMARY KEY,
        nombre        varchar(160) NOT NULL,
        ruc           varchar(40)  NOT NULL,
        estado        varchar(20)  NOT NULL DEFAULT 'activa',
        creado_en     timestamptz  NOT NULL DEFAULT now(),
        actualizado_en timestamptz NOT NULL DEFAULT now(),
        eliminado_en  timestamptz,
        CONSTRAINT uq_empresas_ruc UNIQUE (ruc),
        CONSTRAINT ck_empresas_estado CHECK (estado IN ('activa','suspendida'))
      )`);

    // ── catálogo global de permisos ─────────────────────────────────────────
    // Sin empresa_id a propósito: el vocabulario de permisos es del sistema,
    // no de cada operadora. Lo que varía por empresa es qué rol agrupa cuáles.
    await q.query(`
      CREATE TABLE permisos (
        permiso_id  bigserial PRIMARY KEY,
        codigo      varchar(80) NOT NULL,
        descripcion varchar(240) NOT NULL,
        modulo      varchar(40)  NOT NULL,
        CONSTRAINT uq_permisos_codigo UNIQUE (codigo)
      )`);

    await q.query(`
      CREATE TABLE roles (
        rol_id      bigserial PRIMARY KEY,
        empresa_id  bigint NOT NULL REFERENCES empresas(empresa_id),
        nombre      varchar(80) NOT NULL,
        descripcion varchar(240),
        exige_mfa   boolean NOT NULL DEFAULT false,
        creado_en   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_roles_empresa_nombre UNIQUE (empresa_id, nombre)
      )`);

    await q.query(`
      CREATE TABLE roles_permisos (
        rol_id     bigint NOT NULL REFERENCES roles(rol_id) ON DELETE CASCADE,
        permiso_id bigint NOT NULL REFERENCES permisos(permiso_id) ON DELETE CASCADE,
        PRIMARY KEY (rol_id, permiso_id)
      )`);

    // ── usuarios ────────────────────────────────────────────────────────────
    // El secreto TOTP viaja cifrado desde la aplicación (AES-256-GCM): en la
    // base nunca hay un secreto utilizable aunque se filtre un respaldo.
    await q.query(`
      CREATE TABLE usuarios (
        usuario_id       bigserial PRIMARY KEY,
        empresa_id       bigint NOT NULL REFERENCES empresas(empresa_id),
        nombre           varchar(160) NOT NULL,
        correo           varchar(160) NOT NULL,
        hash_clave       varchar(120) NOT NULL,
        telefono         varchar(40),
        estado           varchar(20) NOT NULL DEFAULT 'activo',
        mfa_habilitado   boolean NOT NULL DEFAULT false,
        mfa_secreto      text,
        mfa_confirmado_en timestamptz,
        cedula_cifrada   bytea,
        ultimo_acceso_en timestamptz,
        creado_en        timestamptz NOT NULL DEFAULT now(),
        actualizado_en   timestamptz NOT NULL DEFAULT now(),
        eliminado_en     timestamptz,
        CONSTRAINT uq_usuarios_empresa_correo UNIQUE (empresa_id, correo),
        CONSTRAINT ck_usuarios_estado CHECK (estado IN ('activo','suspendido'))
      )`);

    await q.query(`
      CREATE TABLE usuarios_roles (
        usuario_id bigint NOT NULL REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
        rol_id     bigint NOT NULL REFERENCES roles(rol_id) ON DELETE CASCADE,
        PRIMARY KEY (usuario_id, rol_id)
      )`);

    // ── dispositivos ────────────────────────────────────────────────────────
    // §7 «Bloqueo remoto»: revocar el dispositivo invalida su refresh token.
    await q.query(`
      CREATE TABLE dispositivos (
        dispositivo_id bigserial PRIMARY KEY,
        empresa_id     bigint NOT NULL REFERENCES empresas(empresa_id),
        usuario_id     bigint NOT NULL REFERENCES usuarios(usuario_id),
        identificador  varchar(120) NOT NULL,
        nombre         varchar(120),
        plataforma     varchar(40),
        ultimo_uso_en  timestamptz,
        creado_en      timestamptz NOT NULL DEFAULT now(),
        revocado_en    timestamptz,
        revocado_por   bigint REFERENCES usuarios(usuario_id),
        CONSTRAINT uq_dispositivos_usuario_ident UNIQUE (usuario_id, identificador)
      )`);
    await q.query(`CREATE INDEX ix_dispositivos_usuario ON dispositivos (usuario_id) WHERE revocado_en IS NULL`);

    // ── auditoría append-only (§21) ─────────────────────────────────────────
    await q.query(`
      CREATE TABLE auditoria (
        auditoria_id   bigserial PRIMARY KEY,
        empresa_id     bigint NOT NULL REFERENCES empresas(empresa_id),
        usuario_id     bigint REFERENCES usuarios(usuario_id),
        accion         varchar(80)  NOT NULL,
        entidad        varchar(80)  NOT NULL,
        entidad_id     varchar(80),
        valor_anterior jsonb,
        valor_nuevo    jsonb,
        motivo         varchar(400),
        ip             inet,
        dispositivo    varchar(240),
        ruta           varchar(240),
        ocurrido_en    timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX ix_auditoria_empresa_fecha ON auditoria (empresa_id, ocurrido_en DESC)`);
    await q.query(`CREATE INDEX ix_auditoria_entidad ON auditoria (entidad, entidad_id)`);

    // ── idempotencia (ADR 004) ──────────────────────────────────────────────
    // La huella evita el peor caso: reusar una clave con un cuerpo distinto y
    // recibir la respuesta de otra operación. Se responde 422 en vez de mentir.
    await q.query(`
      CREATE TABLE claves_idempotencia (
        clave_id    bigserial PRIMARY KEY,
        empresa_id  bigint NOT NULL REFERENCES empresas(empresa_id),
        clave       varchar(120) NOT NULL,
        huella      char(64)     NOT NULL,
        estado      varchar(20)  NOT NULL DEFAULT 'en_curso',
        codigo_http smallint,
        respuesta   jsonb,
        creado_en   timestamptz NOT NULL DEFAULT now(),
        expira_en   timestamptz NOT NULL,
        CONSTRAINT uq_idempotencia_empresa_clave UNIQUE (empresa_id, clave),
        CONSTRAINT ck_idempotencia_estado CHECK (estado IN ('en_curso','completada'))
      )`);
    await q.query(`CREATE INDEX ix_idempotencia_expira ON claves_idempotencia (expira_en)`);

    // ── Row Level Security (ADR 003) ────────────────────────────────────────
    // `current_setting(..., true)` devuelve NULL si nadie fijó el contexto, y
    // `empresa_id = NULL` es NULL, que no es TRUE: sin contexto no se ve nada.
    // Falla cerrado, que es la única forma aceptable de fallar aquí.
    const conEmpresa = ['empresas', 'roles', 'usuarios', 'dispositivos', 'auditoria', 'claves_idempotencia'];
    for (const tabla of conEmpresa) {
      const columna = tabla === 'empresas' ? 'empresa_id' : 'empresa_id';
      await q.query(`ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY`);
      await q.query(`
        CREATE POLICY aislamiento_empresa ON ${tabla}
          USING (${columna} = nullif(current_setting('app.empresa_id', true), '')::bigint)
          WITH CHECK (${columna} = nullif(current_setting('app.empresa_id', true), '')::bigint)`);
    }

    // Las tablas puente no tienen empresa_id propio: heredan el aislamiento de
    // su lado fuerte. Se aísla por existencia de la fila padre visible, que ya
    // está filtrada por su propia política.
    for (const [tabla, padre, fk, pk] of [
      ['usuarios_roles', 'usuarios', 'usuario_id', 'usuario_id'],
      ['roles_permisos', 'roles', 'rol_id', 'rol_id'],
    ] as const) {
      await q.query(`ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY`);
      await q.query(`
        CREATE POLICY aislamiento_empresa ON ${tabla}
          USING (EXISTS (SELECT 1 FROM ${padre} p WHERE p.${pk} = ${tabla}.${fk}))
          WITH CHECK (EXISTS (SELECT 1 FROM ${padre} p WHERE p.${pk} = ${tabla}.${fk}))`);
    }

    // ── rol de aplicación ───────────────────────────────────────────────────
    const usuarioApp = process.env.DATABASE_APP_USER || 'fleetfuel_app';
    const claveApp = process.env.DATABASE_APP_PASSWORD || 'cambiar_en_produccion_app';
    if (!/^[a-z_][a-z0-9_]*$/.test(usuarioApp)) {
      throw new Error(`DATABASE_APP_USER inválido: ${usuarioApp}`);
    }
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${usuarioApp}') THEN
          CREATE ROLE ${usuarioApp} LOGIN PASSWORD ${literal(claveApp)};
        END IF;
      END $$`);

    await q.query(`GRANT USAGE ON SCHEMA public TO ${usuarioApp}`);
    await q.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${usuarioApp}`);
    await q.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${usuarioApp}`);

    // §21: la auditoría no se corrige, se complementa con un registro nuevo.
    await q.query(`REVOKE UPDATE ON auditoria FROM ${usuarioApp}`);
    // §7 regla 14: los registros críticos no se eliminan, se marcan.
    await q.query(`REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM ${usuarioApp}`);
    // El catálogo de permisos lo gobierna una migración, no la aplicación.
    await q.query(`REVOKE INSERT, UPDATE ON permisos FROM ${usuarioApp}`);

    // ── resolución de login sin aflojar la RLS ──────────────────────────────
    // El huevo y la gallina del multiempresa: para fijar `app.empresa_id` hay
    // que saber a qué empresa pertenece el correo, pero sin ese contexto la RLS
    // no deja leer `usuarios`. La salida barata sería que la aplicación se
    // conecte como dueño para el login — y entonces la RLS deja de ser una
    // garantía y pasa a ser una convención.
    //
    // En su lugar, una función SECURITY DEFINER: corre con los privilegios del
    // dueño (que evade RLS), devuelve sólo lo que el login necesita y nada más,
    // y `search_path` fijo para que no se pueda secuestrar con un esquema
    // sombra. La aplicación puede ejecutarla, pero no puede leer la tabla.
    await q.query(`
      CREATE FUNCTION fn_login_resolver(p_correo text)
      RETURNS TABLE (
        empresa_id bigint, usuario_id bigint, nombre varchar,
        hash_clave varchar, estado varchar,
        mfa_habilitado boolean, mfa_secreto text
      )
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
        SELECT u.empresa_id, u.usuario_id, u.nombre,
               u.hash_clave, u.estado, u.mfa_habilitado, u.mfa_secreto
          FROM usuarios u
          JOIN empresas e ON e.empresa_id = u.empresa_id
         WHERE lower(u.correo) = lower(p_correo)
           AND u.eliminado_en IS NULL
           AND e.eliminado_en IS NULL
           AND e.estado = 'activa'
      $fn$`);
    await q.query(`REVOKE ALL ON FUNCTION fn_login_resolver(text) FROM PUBLIC`);
    await q.query(`GRANT EXECUTE ON FUNCTION fn_login_resolver(text) TO ${usuarioApp}`);

    // Un correo identifica a una persona en todo el sistema, no dentro de una
    // empresa. Es lo que permite que el login pida sólo correo y clave, sin
    // selector de operadora. Si algún día una persona debe operar dos empresas,
    // esto es lo que hay que quitar — y el login gana un paso.
    await q.query(`
      CREATE UNIQUE INDEX uq_usuarios_correo_global
        ON usuarios (lower(correo)) WHERE eliminado_en IS NULL`);

    // ── catálogo inicial de permisos (§7) ───────────────────────────────────
    await q.query(`
      INSERT INTO permisos (codigo, descripcion, modulo) VALUES
        ('usuarios:leer',          'Ver usuarios de la empresa',                 'usuarios'),
        ('usuarios:crear',         'Crear usuarios',                             'usuarios'),
        ('usuarios:actualizar',    'Modificar usuarios',                         'usuarios'),
        ('usuarios:suspender',     'Suspender o reactivar usuarios',             'usuarios'),
        ('roles:leer',             'Ver roles y sus permisos',                   'roles'),
        ('roles:administrar',      'Crear roles y asignarles permisos',          'roles'),
        ('dispositivos:leer',      'Ver dispositivos registrados',               'dispositivos'),
        ('dispositivos:revocar',   'Revocar el dispositivo de un conductor',     'dispositivos'),
        ('auditoria:leer',         'Consultar la bitácora de cambios',           'auditoria'),
        ('empresas:leer',          'Ver los datos de la empresa operadora',      'empresas'),
        ('empresas:administrar',   'Modificar los datos de la empresa',          'empresas')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    const usuarioApp = process.env.DATABASE_APP_USER || 'fleetfuel_app';
    await q.query(`DROP FUNCTION IF EXISTS fn_login_resolver(text)`);
    for (const tabla of ['claves_idempotencia', 'auditoria', 'dispositivos', 'roles_permisos',
                         'usuarios_roles', 'usuarios', 'roles', 'permisos', 'empresas']) {
      await q.query(`DROP TABLE IF EXISTS ${tabla} CASCADE`);
    }
    await q.query(`DROP OWNED BY ${usuarioApp} CASCADE`).catch(() => undefined);
    await q.query(`DROP ROLE IF EXISTS ${usuarioApp}`).catch(() => undefined);
  }
}

/** Escapa un literal para SQL. La contraseña viene de entorno, no de usuarios,
 *  pero interpolarla sin escapar es la clase de atajo que se convierte en
 *  inyección cuando alguien reutiliza esta migración con otra fuente. */
function literal(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}
