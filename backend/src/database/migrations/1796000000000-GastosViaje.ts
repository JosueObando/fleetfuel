import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * §7.17 `gastos_viaje` — el segundo entregable de la Fase 1C.
 *
 * POR QUÉ ESTE SÍ Y LIQUIDACIONES NO
 *
 * La compuerta 🏁 del §19 protege lo que la operación real redefine, y lo dice
 * de las liquidaciones por su nombre: «se diseñan mucho mejor cuando ya existen
 * viajes reales que liquidar». Un gasto no es eso: sus once campos son los del
 * §7.17 uno a uno, sus categorías están enumeradas ahí, y quién lo captura lo
 * fija el §5 —«el Conductor registra eventos, GASTOS y evidencias»—. Lo que la
 * operación enseñará es cuánto se gasta y en qué, no qué es un gasto.
 *
 * LA REGLA QUE NO ESTÁ ESCRITA PERO SE DEDUCE
 *
 * `reembolsable` sólo tiene sentido si pagó el conductor. Un gasto que pagó la
 * empresa y además se le reembolsa a alguien se paga dos veces, y eso no lo
 * detecta ninguna revisión de importes: los dos apuntes son correctos por
 * separado. Se cierra con una CHECK porque es una relación entre dos columnas
 * de la misma fila, que es exactamente lo que una CHECK sabe vigilar.
 *
 * Es la clase de error que la liquidación del §10.6 heredaría sin poder verlo:
 * sumaría un reembolso legítimo sobre un gasto que la empresa ya pagó.
 */
export class GastosViaje1796000000000 implements MigrationInterface {
  name = 'GastosViaje1796000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE gastos_viaje (
        gasto_id         bigserial PRIMARY KEY,
        empresa_id       bigint NOT NULL REFERENCES empresas(empresa_id),
        viaje_id         bigint NOT NULL REFERENCES viajes(viaje_id),

        categoria        varchar(20) NOT NULL,
        descripcion      varchar(400) NOT NULL,
        monto            numeric(12,2) NOT NULL,
        fecha            date NOT NULL DEFAULT current_date,
        comprobante      varchar(200),
        pagado_por       varchar(12) NOT NULL,
        reembolsable     boolean NOT NULL DEFAULT false,

        estado           varchar(12) NOT NULL DEFAULT 'pendiente',
        registrado_por   bigint NOT NULL REFERENCES usuarios(usuario_id),
        aprobado_por     bigint REFERENCES usuarios(usuario_id),
        aprobado_en      timestamptz,
        motivo_resolucion text,

        creado_en        timestamptz NOT NULL DEFAULT now(),
        actualizado_en   timestamptz NOT NULL DEFAULT now(),

        -- Las cinco categorías del §7.17, ni una más.
        CONSTRAINT ck_gastos_categoria CHECK (
          categoria IN ('peaje','viatico','reparacion','estacionamiento','otro')),
        CONSTRAINT ck_gastos_pagado_por CHECK (pagado_por IN ('empresa','conductor')),
        CONSTRAINT ck_gastos_estado CHECK (estado IN ('pendiente','aprobado','rechazado')),
        CONSTRAINT ck_gastos_monto CHECK (monto > 0),
        -- Un gasto de cero no es un gasto, y uno negativo es una devolución:
        -- si alguna vez hacen falta devoluciones, serán su propio concepto y no
        -- un importe con signo escondido aquí.

        -- Lo que la empresa pagó no se le reembolsa a nadie: sería pagarlo dos
        -- veces, y los dos apuntes serían correctos por separado.
        CONSTRAINT ck_gastos_reembolso CHECK (
          NOT (pagado_por = 'empresa' AND reembolsable)),

        -- Aprobado o rechazado dice QUIÉN y CUÁNDO, o no lo está.
        CONSTRAINT ck_gastos_resolucion CHECK (
          (estado = 'pendiente' AND aprobado_por IS NULL AND aprobado_en IS NULL)
          OR (estado <> 'pendiente' AND aprobado_por IS NOT NULL AND aprobado_en IS NOT NULL)),
        CONSTRAINT ck_gastos_descripcion CHECK (length(btrim(descripcion)) >= 3)
      )`);

    await q.query(`CREATE INDEX ix_gastos_viaje ON gastos_viaje (empresa_id, viaje_id)`);
    await q.query(
      `CREATE INDEX ix_gastos_pendientes ON gastos_viaje (empresa_id, estado)
         WHERE estado = 'pendiente'`);

    await q.query(`ALTER TABLE gastos_viaje ENABLE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY aislamiento_empresa ON gastos_viaje
        USING (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)
        WITH CHECK (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)`);

    const usuarioApp = process.env.DATABASE_APP_USER || 'fleetfuel_app';
    // Sin DELETE (regla 14): un gasto rechazado es parte de la traza de qué se
    // pidió cobrar, y es justo el que interesa poder mirar después.
    await q.query(`GRANT SELECT, INSERT, UPDATE ON gastos_viaje TO ${usuarioApp}`);
    await q.query(
      `GRANT USAGE, SELECT ON SEQUENCE gastos_viaje_gasto_id_seq TO ${usuarioApp}`);

    const PERMISOS: Array<[string, string]> = [
      ['gastos:leer', 'Ver los gastos de un viaje'],
      ['gastos:crear', 'Registrar un gasto de viaje'],
      ['gastos:aprobar', 'Aprobar o rechazar un gasto'],
    ];
    for (const [codigo, descripcion] of PERMISOS) {
      await q.query(
        `INSERT INTO permisos (codigo, modulo, descripcion) VALUES ($1,'gastos',$2)
           ON CONFLICT (codigo) DO NOTHING`, [codigo, descripcion]);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM roles_permisos WHERE permiso_id IN
                     (SELECT permiso_id FROM permisos WHERE modulo = 'gastos')`);
    await q.query(`DELETE FROM permisos WHERE modulo = 'gastos'`);
    await q.query(`DROP TABLE IF EXISTS gastos_viaje`);
  }
}
