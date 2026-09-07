import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * §7.14 `entregas` — el eslabón que cierra `orden → carga → viaje → entrega`.
 *
 * QUÉ TRAE DE LA FASE 1C Y QUÉ NO
 *
 * Trae la CAPTURA de la entrega y su conciliación de volúmenes. No trae
 * liquidaciones, y eso es deliberado: la compuerta 🏁 del §19 existe sobre todo
 * por ellas —«el módulo de liquidaciones se diseña mucho mejor cuando ya
 * existen viajes reales que liquidar»—. Lo que se construye aquí está fijado
 * por el PRD y no por lo que se aprenda operando: los campos son los del §7.14,
 * las fórmulas las del §10.4 y §10.5, y las reglas las 7, 8, 9 y 20 del §11.
 *
 * LAS DOS COLUMNAS CALCULADAS
 *
 * `diferencia_volumen` y `porcentaje_merma` se almacenan generadas y no se
 * recalculan al leer, por el mismo motivo que `volumen_pendiente` en
 * `detalles_orden`: se consultan constantemente y derivarlas en cada consulta
 * invita a que dos sitios lo calculen distinto. Y siendo GENERATED, ningún
 * servicio puede escribir una merma que no cuadre con sus propios volúmenes.
 *
 * LA COTA DEL ACUMULADO, ESTA VEZ DESDE EL PRINCIPIO
 *
 * La regla 20 pide que las entregas parciales actualicen el volumen pendiente,
 * y `detalles_orden.volumen_pendiente` es `solicitado - entregado`. Sin cota
 * superior, entregar de más lo dejaría NEGATIVO y la orden parecería deber
 * volumen. Es exactamente el agujero que `ck_detalles_planificado_cabe` cerró
 * para el plan de carga en la migración 1792, encontrado allí a base de una
 * carrera; aquí se pone antes de que haya nada que romper.
 */
export class Entregas1793000000000 implements MigrationInterface {
  name = 'Entregas1793000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE entregas (
        entrega_id          bigserial PRIMARY KEY,
        empresa_id          bigint NOT NULL REFERENCES empresas(empresa_id),
        viaje_id            bigint NOT NULL REFERENCES viajes(viaje_id),
        orden_id            bigint NOT NULL REFERENCES ordenes_abastecimiento(orden_id),
        detalle_orden_id    bigint NOT NULL REFERENCES detalles_orden(detalle_orden_id),
        estacion_id         bigint NOT NULL REFERENCES estaciones_servicio(estacion_id),
        producto_id         bigint NOT NULL REFERENCES productos_combustible(producto_id),
        compartimento_id    bigint NOT NULL REFERENCES compartimentos_cisterna(compartimento_id),

        volumen_cargado     numeric(12,2) NOT NULL,
        volumen_descargado  numeric(12,2),
        volumen_recibido    numeric(12,2) NOT NULL,
        -- §10.5: diferencia = cargado − recibido. Positiva es merma; negativa
        -- significa que se recibió más de lo que salió, que es igual de anómalo
        -- y por eso la regla 9 se aplica sobre el valor ABSOLUTO.
        diferencia_volumen  numeric(12,2) GENERATED ALWAYS AS
                              (volumen_cargado - volumen_recibido) STORED,
        porcentaje_merma    numeric(7,4) GENERATED ALWAYS AS
                              (CASE WHEN volumen_cargado > 0
                                    THEN (volumen_cargado - volumen_recibido) / volumen_cargado * 100
                                    ELSE 0 END) STORED,

        medidor_inicial     numeric(14,2),
        medidor_final       numeric(14,2),
        sello_recibido      varchar(60),
        estado_sello        varchar(20),

        receptor_nombre     varchar(160) NOT NULL,
        receptor_documento  varchar(40),
        firma_digital       text,

        -- Regla 8: «Toda entrega debe incluir geolocalización». NOT NULL y no
        -- una comprobación del servicio: es la única forma de que una entrega
        -- sin ubicación no pueda existir, viniera por donde viniera.
        latitud             numeric(10,7) NOT NULL,
        longitud            numeric(10,7) NOT NULL,

        fecha_llegada       timestamptz,
        fecha_descarga      timestamptz NOT NULL DEFAULT now(),
        documento_entrega   varchar(200),
        observaciones       text,
        estado              varchar(20) NOT NULL DEFAULT 'pendiente',
        -- Regla 9: quién aprobó una diferencia fuera de tolerancia, y cuándo.
        aprobada_por        bigint REFERENCES usuarios(usuario_id),
        aprobada_en         timestamptz,
        motivo_aprobacion   text,

        creado_en           timestamptz NOT NULL DEFAULT now(),
        actualizado_en      timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT ck_entregas_estado CHECK (estado IN ('pendiente','aceptada','parcial','rechazada')),
        CONSTRAINT ck_entregas_sello CHECK (
          estado_sello IS NULL OR estado_sello IN ('intacto','roto','inconsistente')),
        CONSTRAINT ck_entregas_volumenes CHECK (
          volumen_cargado > 0 AND volumen_recibido >= 0
          AND (volumen_descargado IS NULL OR volumen_descargado >= 0)),
        -- §10.4: el volumen medido es final − inicial. Un medidor que retrocede
        -- es un dato mal capturado, no una lectura.
        CONSTRAINT ck_entregas_medidores CHECK (
          medidor_inicial IS NULL OR medidor_final IS NULL OR medidor_final >= medidor_inicial),
        CONSTRAINT ck_entregas_geo CHECK (
          latitud BETWEEN -90 AND 90 AND longitud BETWEEN -180 AND 180),
        -- Una entrega aprobada tiene que decir quién y cuándo: las tres van
        -- juntas o no va ninguna.
        CONSTRAINT ck_entregas_aprobacion CHECK (
          (aprobada_por IS NULL) = (aprobada_en IS NULL))
      )`);

    await q.query(`CREATE INDEX ix_entregas_viaje ON entregas (empresa_id, viaje_id)`);
    await q.query(`CREATE INDEX ix_entregas_orden ON entregas (empresa_id, orden_id)`);
    await q.query(
      `CREATE INDEX ix_entregas_pendientes ON entregas (empresa_id, estado) WHERE estado = 'pendiente'`);

    // La cota del acumulado de la regla 20, puesta antes de que haya datos.
    await q.query(`
      ALTER TABLE detalles_orden
        ADD CONSTRAINT ck_detalles_entregado_cabe
        CHECK (volumen_entregado <= volumen_solicitado)`);

    // ── RLS y privilegios, igual que el resto de tablas de negocio ──────────
    await q.query(`ALTER TABLE entregas ENABLE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY aislamiento_empresa ON entregas
        USING (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)
        WITH CHECK (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)`);

    const usuarioApp = process.env.DATABASE_APP_USER || 'fleetfuel_app';
    // Sin DELETE: la regla 14 prohíbe borrar registros críticos, y una entrega
    // es la prueba de que el combustible llegó.
    await q.query(`GRANT SELECT, INSERT, UPDATE ON entregas TO ${usuarioApp}`);
    await q.query(`GRANT USAGE, SELECT ON SEQUENCE entregas_entrega_id_seq TO ${usuarioApp}`);

    // ── Permisos (§5) ──────────────────────────────────────────────────────
    const PERMISOS: Array<[string, string]> = [
      ['entregas:leer', 'Ver entregas'],
      ['entregas:crear', 'Registrar una entrega en estación'],
      // Aparte, y por el mismo motivo que `viajes:autorizar`: quien captura la
      // entrega no puede ser quien perdona su diferencia de volumen. Es la
      // separación del §7 aplicada al fraude de volumen.
      ['entregas:aprobar', 'Aprobar una diferencia de volumen fuera de tolerancia'],
    ];
    for (const [codigo, descripcion] of PERMISOS) {
      await q.query(
        `INSERT INTO permisos (codigo, modulo, descripcion) VALUES ($1,'entregas',$2)
           ON CONFLICT (codigo) DO NOTHING`, [codigo, descripcion]);
    }
    // El reparto a roles NO se hace aquí: vive en `reparto-permisos.ts` y lo
    // aplica la semilla. Repartir desde una migración fue el fallo que dejó a
    // producción con un administrador de 11 permisos sobre 48.
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM roles_permisos WHERE permiso_id IN
                     (SELECT permiso_id FROM permisos WHERE modulo = 'entregas')`);
    await q.query(`DELETE FROM permisos WHERE modulo = 'entregas'`);
    await q.query(`ALTER TABLE detalles_orden DROP CONSTRAINT IF EXISTS ck_detalles_entregado_cabe`);
    await q.query(`DROP TABLE IF EXISTS entregas`);
  }
}
