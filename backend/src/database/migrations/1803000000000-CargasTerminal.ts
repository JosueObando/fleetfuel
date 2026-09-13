import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * §7.13 `cargas_terminal` — el eslabón que faltaba entre el plan y la entrega.
 *
 * POR QUÉ APARECE TAN TARDE
 *
 * No estaba en ninguna fase del plan de construcción. Se encontró auditando el
 * backend contra el §7 del PRD el 2026-09-12: de las 19 tablas del modelo de
 * datos había 16, y ésta era la única de las tres ausentes que no pertenece a
 * la Fase 3. El flujo `orden → plan de carga → viaje → entrega` se dio por
 * cerrado sin ella, y el hueco no se ve desde dentro porque la máquina de
 * estados sí tiene `cargando → cargado`: el viaje pasa por la terminal, pero no
 * quedaba constancia de qué pasó allí.
 *
 * LA REGLA 18, QUE ES LA RAZÓN DE SER DE ESTA TABLA
 *
 * «Todo sello debe quedar asociado a UNA CARGA y verificarse en la entrega.»
 * Hasta ahora sólo existía la segunda mitad: `entregas.sello_recibido` lo
 * escribía quien registraba la entrega, y `entregas.estado_sello` lo elegía esa
 * misma persona de una lista de tres. Un control de cadena de custodia en el
 * que el mismo actor pone el dato y lo califica no es un control: la alerta
 * `sello_inconsistente` sólo disparaba cuando alguien ya había confesado.
 *
 * Con esta tabla el sello nace en la terminal, y la entrega lo CONTRASTA. La
 * comparación la hace el servicio, no la persona.
 *
 * Y ES EL VOLUMEN, NO SÓLO EL SELLO
 *
 * `entregas.volumen_cargado` se venía copiando de `plan_carga.volumen_planificado`
 * — o sea que la merma del §10.5 se calculaba contra lo que se PENSABA cargar y
 * no contra lo que se cargó. En un sistema cuyo riesgo declarado es el fraude
 * de volumen, ésa es la resta que importa, y estaba mal el sustraendo.
 *
 * UNA CARGA POR COMPARTIMENTO Y VIAJE
 *
 * La regla 5 del §11 dice que «cada compartimento debe tener un único producto
 * durante el viaje». Un índice único sobre (viaje, compartimento) es la forma
 * de que eso no dependa de que nadie inserte dos veces.
 */
export class CargasTerminal1803000000000 implements MigrationInterface {
  name = 'CargasTerminal1803000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE cargas_terminal (
        carga_id             bigserial PRIMARY KEY,
        empresa_id           bigint NOT NULL REFERENCES empresas(empresa_id),
        viaje_id             bigint NOT NULL REFERENCES viajes(viaje_id),
        compartimento_id     bigint NOT NULL REFERENCES compartimentos_cisterna(compartimento_id),
        -- La línea de orden que esta carga sirve. No está en la tabla del
        -- §7.13, y hace falta: sin ella la entrega no sabe CUÁL de las cargas
        -- del viaje le corresponde, que es justo lo que tiene que contrastar.
        detalle_orden_id     bigint NOT NULL REFERENCES detalles_orden(detalle_orden_id),
        producto_id          bigint NOT NULL REFERENCES productos_combustible(producto_id),

        -- Lo que el plan decía, congelado al registrar: si luego alguien
        -- reordena el plan, la diferencia contra lo cargado seguiría siendo
        -- legible. Derivarlo al leer haría que el pasado cambiara solo.
        volumen_programado   numeric(12,2) NOT NULL,
        volumen_cargado      numeric(12,2) NOT NULL,
        diferencia_programado numeric(12,2) GENERATED ALWAYS AS
                               (volumen_cargado - volumen_programado) STORED,

        medidor_inicial      numeric(14,2),
        medidor_final        numeric(14,2),
        -- §7.13 los llama opcionales: no toda terminal los toma, y exigirlos
        -- obligaría a inventarlos.
        temperatura          numeric(6,2),
        densidad             numeric(8,4),

        -- El sello. NOT NULL porque una carga sin sello no puede cumplir la
        -- regla 18: si se admitiera nulo, la entrega no tendría contra qué
        -- contrastar y volveríamos exactamente a donde estábamos.
        numero_sello         varchar(60) NOT NULL,
        operador_terminal    varchar(160) NOT NULL,

        fecha_inicio         timestamptz NOT NULL DEFAULT now(),
        fecha_fin            timestamptz,

        -- §9 Etapa 5: «Se registra geolocalización y hora». Mismo criterio que
        -- la regla 8 en entregas: si es obligatorio, es NOT NULL y no una
        -- comprobación del servicio que alguien pueda rodear por otro camino.
        latitud              numeric(10,7) NOT NULL,
        longitud             numeric(10,7) NOT NULL,

        documento_carga      varchar(200),
        evidencia_fotografica text,
        firma_operador       text,

        estado_validacion    varchar(20) NOT NULL DEFAULT 'pendiente',
        validada_por         bigint REFERENCES usuarios(usuario_id),
        fecha_validacion     timestamptz,
        motivo_validacion    text,

        creado_en            timestamptz NOT NULL DEFAULT now(),
        actualizado_en       timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT ck_cargas_estado CHECK (
          estado_validacion IN ('pendiente','validada','rechazada')),
        CONSTRAINT ck_cargas_volumenes CHECK (
          volumen_programado > 0 AND volumen_cargado >= 0),
        CONSTRAINT ck_cargas_medidores CHECK (
          medidor_inicial IS NULL OR medidor_final IS NULL OR medidor_final >= medidor_inicial),
        CONSTRAINT ck_cargas_geo CHECK (
          latitud BETWEEN -90 AND 90 AND longitud BETWEEN -180 AND 180),
        -- La densidad y la temperatura, cuando vienen, tienen que ser físicas.
        -- Una densidad de cero o negativa no es «sin dato»: es un dato falso, y
        -- el sitio donde se distingue una cosa de la otra es aquí.
        CONSTRAINT ck_cargas_densidad CHECK (densidad IS NULL OR densidad > 0),
        CONSTRAINT ck_cargas_temperatura CHECK (
          temperatura IS NULL OR temperatura BETWEEN -50 AND 150),
        -- Validada o rechazada exige quién y cuándo, las tres juntas.
        CONSTRAINT ck_cargas_validacion CHECK (
          (validada_por IS NULL) = (fecha_validacion IS NULL)),
        CONSTRAINT ck_cargas_fechas CHECK (
          fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
      )`);

    // Regla 5 · «Cada compartimento debe tener un único producto durante el
    // viaje». Una carga por compartimento y viaje lo garantiza en la base.
    await q.query(`
      CREATE UNIQUE INDEX uq_cargas_viaje_compartimento
        ON cargas_terminal (empresa_id, viaje_id, compartimento_id)`);

    // Regla 18 · Un número de sello identifica UNA carga. Sin esto el mismo
    // sello podría aparecer en dos cargas y la verificación de la entrega
    // dejaría de significar algo.
    await q.query(`
      CREATE UNIQUE INDEX uq_cargas_sello ON cargas_terminal (empresa_id, numero_sello)`);

    await q.query(`CREATE INDEX ix_cargas_viaje ON cargas_terminal (empresa_id, viaje_id)`);
    await q.query(`
      CREATE INDEX ix_cargas_pendientes ON cargas_terminal (empresa_id, estado_validacion)
        WHERE estado_validacion = 'pendiente'`);

    // ── La entrega apunta a la carga que la surtió ──────────────────────────
    //
    // Nulable, y no por transigir: una entrega SIN carga asociada no se puede
    // crear —el servicio la exige— pero la columna tiene que admitir nulo para
    // que esta migración pueda correr sobre bases que ya tengan entregas. Hoy
    // no hay ninguna en los tres entornos (comprobado), así que el nulo es una
    // puerta que nadie va a cruzar; dejarla NOT NULL haría que la migración
    // fallara en cualquier base que sí las tuviera.
    await q.query(`
      ALTER TABLE entregas
        ADD COLUMN carga_id bigint REFERENCES cargas_terminal(carga_id)`);
    await q.query(`CREATE INDEX ix_entregas_carga ON entregas (empresa_id, carga_id)`);

    // ── RLS y privilegios, igual que el resto de tablas de negocio ──────────
    await q.query(`ALTER TABLE cargas_terminal ENABLE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY aislamiento_empresa ON cargas_terminal
        USING (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)
        WITH CHECK (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)`);

    const usuarioApp = process.env.DATABASE_APP_USER || 'fleetfuel_app';
    // Sin DELETE: la regla 14. Una carga es la prueba de qué salió de la
    // terminal, y es el origen de la cadena de custodia del sello.
    await q.query(`GRANT SELECT, INSERT, UPDATE ON cargas_terminal TO ${usuarioApp}`);
    await q.query(
      `GRANT USAGE, SELECT ON SEQUENCE cargas_terminal_carga_id_seq TO ${usuarioApp}`);

    // ── Permisos (§5) ──────────────────────────────────────────────────────
    const PERMISOS: Array<[string, string]> = [
      ['cargas:leer', 'Ver las cargas en terminal'],
      // §5, literal: «Operador de carga — Confirma volúmenes cargados y
      // sellos». El rol existía desde el principio con cuatro permisos de
      // lectura, porque el módulo que le da trabajo es éste.
      ['cargas:registrar', 'Registrar el volumen cargado y el sello en la terminal'],
      // Aparte, y por el mismo motivo que `entregas:aprobar` y
      // `viajes:autorizar`: quien confirma el volumen que salió no puede ser
      // quien da por buena esa confirmación.
      ['cargas:validar', 'Validar o rechazar una carga registrada en terminal'],
    ];
    for (const [codigo, descripcion] of PERMISOS) {
      await q.query(
        `INSERT INTO permisos (codigo, modulo, descripcion) VALUES ($1,'cargas',$2)
           ON CONFLICT (codigo) DO NOTHING`, [codigo, descripcion]);
    }
    // El reparto a roles vive en `reparto-permisos.ts`, no aquí.
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM roles_permisos WHERE permiso_id IN
                     (SELECT permiso_id FROM permisos WHERE modulo = 'cargas')`);
    await q.query(`DELETE FROM permisos WHERE modulo = 'cargas'`);
    await q.query(`DROP INDEX IF EXISTS ix_entregas_carga`);
    await q.query(`ALTER TABLE entregas DROP COLUMN IF EXISTS carga_id`);
    await q.query(`DROP TABLE IF EXISTS cargas_terminal`);
  }
}
