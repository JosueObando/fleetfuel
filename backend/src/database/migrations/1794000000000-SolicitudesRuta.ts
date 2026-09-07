import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * §2C · Solicitudes de cambio de ruta — ALCANCE NUEVO, ahora decidido.
 *
 * DE DÓNDE SALE Y POR QUÉ ESTABA EN DISCUSIÓN
 *
 * Del spec de UX, no del PRD: `RouteRequest { id, type: detour|extra_stop|cancel,
 * requestedBy, requestedAt, reason, state: pending|approved|rejected, resolvedBy,
 * resolvedAt }`, con el componente `RequestList` que aprueba y rechaza en línea.
 *
 * En el PRD, «desvío» aparece SÓLO como alerta detectada (§22) y como evento del
 * flujo (§9): es reactivo —el sistema se entera de que el camión se salió— y no
 * un flujo de aprobación —alguien PIDE salirse y otro lo autoriza—. Son dos
 * cosas distintas y ninguna sustituye a la otra: la alerta seguirá existiendo
 * para el desvío que nadie pidió, que es justamente el que importa vigilar.
 *
 * LA REGLA QUE LA HACE ÚTIL
 *
 * Quien solicita no resuelve. Sin eso, «solicitud de cambio de ruta» es un
 * formulario que el conductor se aprueba solo, y el registro que deja no prueba
 * nada. Es el mismo criterio que separa `viajes:crear` de `viajes:autorizar` y
 * `entregas:crear` de `entregas:aprobar`, y por el mismo motivo del §7.
 *
 * LO QUE NO TRAE
 *
 * La notificación a la app del conductor, que el plan pide en el mismo punto:
 * esa app es la Fase 2A y todavía no existe. Cuando exista, lo que hay que
 * añadir es el aviso, no el modelo.
 */
export class SolicitudesRuta1794000000000 implements MigrationInterface {
  name = 'SolicitudesRuta1794000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE solicitudes_ruta (
        solicitud_id      bigserial PRIMARY KEY,
        empresa_id        bigint NOT NULL REFERENCES empresas(empresa_id),
        viaje_id          bigint NOT NULL REFERENCES viajes(viaje_id),
        tipo              varchar(20) NOT NULL,
        motivo            text NOT NULL,
        estado            varchar(20) NOT NULL DEFAULT 'pendiente',

        solicitada_por    bigint NOT NULL REFERENCES usuarios(usuario_id),
        solicitada_en     timestamptz NOT NULL DEFAULT now(),
        resuelta_por      bigint REFERENCES usuarios(usuario_id),
        resuelta_en       timestamptz,
        motivo_resolucion text,

        creado_en         timestamptz NOT NULL DEFAULT now(),
        actualizado_en    timestamptz NOT NULL DEFAULT now(),

        -- Los tres tipos del spec, traducidos: detour, extra_stop, cancel.
        CONSTRAINT ck_solicitudes_tipo CHECK (
          tipo IN ('desvio','parada_extra','cancelacion')),
        CONSTRAINT ck_solicitudes_estado CHECK (
          estado IN ('pendiente','aprobada','rechazada')),
        -- Una solicitud resuelta dice QUIÉN y CUÁNDO, o no está resuelta. Las
        -- tres columnas van juntas en las dos direcciones: sin esto, «aprobada»
        -- sin responsable es un permiso que nadie firmó.
        CONSTRAINT ck_solicitudes_resolucion CHECK (
          (estado = 'pendiente' AND resuelta_por IS NULL AND resuelta_en IS NULL)
          OR (estado <> 'pendiente' AND resuelta_por IS NOT NULL AND resuelta_en IS NOT NULL)),
        -- El motivo no puede ser un espacio: una solicitud sin razón legible es
        -- exactamente lo que este flujo existe para no permitir.
        CONSTRAINT ck_solicitudes_motivo CHECK (length(btrim(motivo)) >= 5)
      )`);

    await q.query(
      `CREATE INDEX ix_solicitudes_viaje ON solicitudes_ruta (empresa_id, viaje_id)`);
    await q.query(
      `CREATE INDEX ix_solicitudes_pendientes ON solicitudes_ruta (empresa_id, estado)
         WHERE estado = 'pendiente'`);

    // ── El canal de chat del conductor ─────────────────────────────────────
    //
    // El spec pide `driver.chatChannelId` y un botón en `MapControl`, y NADA
    // más: no define mensajes, ni almacenamiento, ni transporte. Así que lo
    // único que se puede construir hoy sin inventarse el resto es el
    // identificador — que es el mismo campo tanto si mañana el canal lo sirve
    // WhatsApp, Telegram o una mensajería propia.
    //
    // Se guarda como texto opaco a propósito: la aplicación no interpreta su
    // contenido, sólo se lo entrega al panel.
    await q.query(
      `ALTER TABLE conductores ADD COLUMN canal_chat varchar(200)`);

    // ── RLS y privilegios ──────────────────────────────────────────────────
    await q.query(`ALTER TABLE solicitudes_ruta ENABLE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY aislamiento_empresa ON solicitudes_ruta
        USING (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)
        WITH CHECK (empresa_id = nullif(current_setting('app.empresa_id', true), '')::bigint)`);

    const usuarioApp = process.env.DATABASE_APP_USER || 'fleetfuel_app';
    // Sin DELETE: una solicitud denegada es parte de la traza de quién pidió
    // qué, y borrarla dejaría el hueco justo donde interesa mirar.
    await q.query(`GRANT SELECT, INSERT, UPDATE ON solicitudes_ruta TO ${usuarioApp}`);
    await q.query(
      `GRANT USAGE, SELECT ON SEQUENCE solicitudes_ruta_solicitud_id_seq TO ${usuarioApp}`);

    // ── Permisos ───────────────────────────────────────────────────────────
    const PERMISOS: Array<[string, string]> = [
      ['solicitudesruta:leer', 'Ver solicitudes de cambio de ruta'],
      ['solicitudesruta:crear', 'Pedir un cambio de ruta'],
      ['solicitudesruta:resolver', 'Aprobar o rechazar un cambio de ruta'],
    ];
    for (const [codigo, descripcion] of PERMISOS) {
      await q.query(
        `INSERT INTO permisos (codigo, modulo, descripcion)
         VALUES ($1,'solicitudesruta',$2) ON CONFLICT (codigo) DO NOTHING`,
        [codigo, descripcion]);
    }
    // El reparto vive en `reparto-permisos.ts` y lo aplica la semilla.
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM roles_permisos WHERE permiso_id IN
                     (SELECT permiso_id FROM permisos WHERE modulo = 'solicitudesruta')`);
    await q.query(`DELETE FROM permisos WHERE modulo = 'solicitudesruta'`);
    await q.query(`ALTER TABLE conductores DROP COLUMN IF EXISTS canal_chat`);
    await q.query(`DROP TABLE IF EXISTS solicitudes_ruta`);
  }
}
