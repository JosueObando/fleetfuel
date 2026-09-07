import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * §7.18 · `liquidaciones_conductor` — el quinto y último entregable de 1C.
 *
 * QUÉ SE CONSTRUYE Y QUÉ NO
 *
 * La fórmula del pago combinado está escrita literal en el §10.7:
 *
 *   pago = tarifa base + pago por kilómetros + pago por entregas + viáticos
 *          + bonificaciones + reembolsos − penalizaciones autorizadas
 *
 * Eso se construye. Lo que NO entra es la variación de tarifa por ruta, tipo de
 * cisterna, producto, horario nocturno, feriados, riesgo o tiempo de espera
 * —la lista del propio §10.7—: eso es un motor de tarifas, vive en la Fase 3
 * junto al de costos, y es exactamente lo que el uso real va a reformar. Aquí
 * se usan las tarifas del conductor, que ya existen en su ficha desde 1A.
 *
 * LOS TRES CALCULADOS NO SE ESCRIBEN A MANO
 *
 * `pago_kilometros`, `pago_entregas` y `reembolsos` se derivan del viaje: del
 * odómetro, de las entregas aceptadas y de los gastos aprobados y
 * reembolsables. Dejarlos teclear sería permitir que la liquidación diga una
 * cosa y el viaje diga otra, y las dos parecerían correctas por separado.
 *
 * `total_pagar` es GENERATED por el mismo motivo, y además cierra la vía de que
 * alguien apruebe un total que no sale de sus propios sumandos.
 *
 * UNA POR VIAJE
 *
 * Un viaje se liquida una vez. Dos liquidaciones del mismo viaje es pagar dos
 * veces, y el segundo apunte se ve tan legítimo como el primero.
 */
export class Liquidaciones1798000000000 implements MigrationInterface {
  name = 'Liquidaciones1798000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE liquidaciones_conductor (
        liquidacion_id   bigserial PRIMARY KEY,
        empresa_id       bigint NOT NULL REFERENCES empresas(empresa_id),
        viaje_id         bigint NOT NULL REFERENCES viajes(viaje_id),
        conductor_id     bigint NOT NULL REFERENCES conductores(conductor_id),

        -- Los tres primeros salen del viaje; los tres siguientes los pone una
        -- persona y por eso llevan su propio motivo cuando no son cero.
        tarifa_base      numeric(12,2) NOT NULL DEFAULT 0,
        pago_kilometros  numeric(12,2) NOT NULL DEFAULT 0,
        pago_entregas    numeric(12,2) NOT NULL DEFAULT 0,
        reembolsos       numeric(12,2) NOT NULL DEFAULT 0,
        viaticos         numeric(12,2) NOT NULL DEFAULT 0,
        bonificaciones   numeric(12,2) NOT NULL DEFAULT 0,
        penalizaciones   numeric(12,2) NOT NULL DEFAULT 0,
        motivo_ajustes   text,

        -- §10.7, tal cual. GENERATED para que nadie pueda aprobar un total que
        -- no salga de sus propios sumandos.
        total_pagar      numeric(12,2) GENERATED ALWAYS AS
                           (tarifa_base + pago_kilometros + pago_entregas + reembolsos
                            + viaticos + bonificaciones - penalizaciones) STORED,

        -- Lo que se guarda del cálculo, para poder explicarlo después sin
        -- recalcularlo contra un viaje que ya cambió.
        kilometros       numeric(12,2),
        entregas_contadas integer NOT NULL DEFAULT 0,
        tarifa_km_usada  numeric(12,2),
        tarifa_entrega_usada numeric(12,2),

        estado           varchar(12) NOT NULL DEFAULT 'pendiente',
        calculada_por    bigint NOT NULL REFERENCES usuarios(usuario_id),
        aprobada_por     bigint REFERENCES usuarios(usuario_id),
        fecha_aprobacion timestamptz,
        pagada_por       bigint REFERENCES usuarios(usuario_id),
        fecha_pago       timestamptz,
        referencia_pago  varchar(120),

        creado_en        timestamptz NOT NULL DEFAULT now(),
        actualizado_en   timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT ck_liq_estado CHECK (estado IN ('pendiente','aprobada','pagada')),
        CONSTRAINT ck_liq_importes CHECK (
          tarifa_base >= 0 AND pago_kilometros >= 0 AND pago_entregas >= 0
          AND reembolsos >= 0 AND viaticos >= 0 AND bonificaciones >= 0
          AND penalizaciones >= 0),
        -- Un viaje se liquida UNA vez: dos apuntes del mismo viaje es pagar dos
        -- veces, y el segundo se ve tan legítimo como el primero.
        CONSTRAINT uq_liq_viaje UNIQUE (viaje_id),

        -- Aprobada dice quién y cuándo; pagada, además, quién pagó y con qué
        -- referencia. Sin esto, «pagada» sin comprobante es un pago que nadie
        -- puede rastrear.
        CONSTRAINT ck_liq_aprobacion CHECK (
          (estado = 'pendiente' AND aprobada_por IS NULL AND fecha_aprobacion IS NULL)
          OR (estado <> 'pendiente' AND aprobada_por IS NOT NULL AND fecha_aprobacion IS NOT NULL)),
        CONSTRAINT ck_liq_pago CHECK (
          (estado <> 'pagada' AND pagada_por IS NULL AND fecha_pago IS NULL
           AND referencia_pago IS NULL)
          OR (estado = 'pagada' AND pagada_por IS NOT NULL AND fecha_pago IS NOT NULL
              AND referencia_pago IS NOT NULL)),
        -- Un ajuste a mano sin explicación es un número que nadie podrá
        -- justificar en la siguiente revisión.
        CONSTRAINT ck_liq_motivo_ajustes CHECK (
          (viaticos = 0 AND bonificaciones = 0 AND penalizaciones = 0)
          OR length(btrim(coalesce(motivo_ajustes, ''))) >= 5)
      )`);

    await q.query(
      `CREATE INDEX ix_liq_conductor ON liquidaciones_conductor (empresa_id, conductor_id)`);
    await q.query(
      `CREATE INDEX ix_liq_pendientes ON liquidaciones_conductor (empresa_id, estado)
         WHERE estado <> 'pagada'`);

    await q.query(`ALTER TABLE liquidaciones_conductor ENABLE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY aislamiento_empresa ON liquidaciones_conductor
        USING (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)
        WITH CHECK (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)`);

    const usuarioApp = process.env.DATABASE_APP_USER || 'fleetfuel_app';
    await q.query(`GRANT SELECT, INSERT, UPDATE ON liquidaciones_conductor TO ${usuarioApp}`);
    await q.query(
      `GRANT USAGE, SELECT ON SEQUENCE liquidaciones_conductor_liquidacion_id_seq TO ${usuarioApp}`);

    const PERMISOS: Array<[string, string]> = [
      ['liquidaciones:leer', 'Ver liquidaciones de conductor'],
      ['liquidaciones:calcular', 'Calcular la liquidación de un viaje'],
      ['liquidaciones:aprobar', 'Aprobar una liquidación'],
      // Separado de aprobar a propósito: firmar el importe y mover el dinero
      // son dos actos, y el §7.18 les da fechas distintas justamente por eso.
      ['liquidaciones:pagar', 'Registrar el pago de una liquidación'],
    ];
    for (const [codigo, descripcion] of PERMISOS) {
      await q.query(
        `INSERT INTO permisos (codigo, modulo, descripcion) VALUES ($1,'liquidaciones',$2)
           ON CONFLICT (codigo) DO NOTHING`, [codigo, descripcion]);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM roles_permisos WHERE permiso_id IN
                     (SELECT permiso_id FROM permisos WHERE modulo = 'liquidaciones')`);
    await q.query(`DELETE FROM permisos WHERE modulo = 'liquidaciones'`);
    await q.query(`DROP TABLE IF EXISTS liquidaciones_conductor`);
  }
}
