import { createServer } from 'node:http';

/*
 * Traductor de avisos: Grafana → ntfy.
 *
 * POR QUÉ EXISTE
 *
 * Grafana no deja dar forma al cuerpo de un webhook: manda SIEMPRE su JSON
 * completo. ntfy toma el cuerpo tal cual como texto de la notificación, así que
 * conectarlos directamente entrega al móvil un muro de JSON con `fingerprint`,
 * `silenceURL` y `generatorURL` dentro. Medido antes de escribir esto: llega
 * legible sólo para una máquina.
 *
 * Y ningún tipo de contacto NATIVO de Grafana sirve aquí: telegram, discord,
 * slack y pushover son servicios de terceros —lo mismo que se descartó al elegir
 * la observabilidad—, y el de correo necesita un SMTP que este sistema no tiene.
 *
 * Así que en medio va esto: treinta líneas, sin dependencias, sobre la imagen de
 * node que ya está descargada. Su única responsabilidad es que la alerta se lea
 * de un vistazo en la pantalla de bloqueo.
 */

const NTFY = process.env.NTFY_URL ?? 'http://ntfy';
const TEMA = process.env.NTFY_TEMA ?? 'fleetfuel';
const PUERTO = Number(process.env.PUERTO ?? 8080);

/* ntfy admite prioridad 1..5. Una alerta crítica tiene que sonar aunque el
   móvil esté en silencio; un aviso no debe despertar a nadie de madrugada. */
export const PRIORIDAD = { critico: 5, aviso: 3 };

/* Una severidad que no está en el mapa ESCALA a crítica en vez de caer a aviso.
   Los dos errores no cuestan lo mismo: escalar de más molesta una vez, escalar
   de menos silencia una caída. Una alerta cuya gravedad no se sabe leer es, por
   definición, una que nadie ha triado.
   La otra mitad de esta defensa está en ops/observabilidad/reglas.test.mjs, que
   impide que una severidad desconocida llegue siquiera a existir. Ésta es la
   red de abajo, por si alguna vez se edita el fichero sin pasar por CI. */
const ESCALA_SI_NO_SE_ENTIENDE = 5;

const linea = (a) =>
  a.annotations?.summary?.trim() || a.labels?.alertname || 'sin descripción';

/** Un texto que se entienda en la pantalla de bloqueo, sin abrir nada. */
export function componer(cuerpo, tema = TEMA) {
  const alertas = cuerpo.alerts ?? [];
  const resuelta = cuerpo.status === 'resolved';
  const severidad = alertas[0]?.labels?.severidad;
  const nombre = cuerpo.groupLabels?.alertname
    ?? alertas[0]?.labels?.alertname ?? 'Alerta';

  const titulo = resuelta ? `Resuelta: ${nombre}` : nombre;

  /* El primer renglón es el QUÉ; después, el detalle de cada alerta del grupo.
     Se limita a cinco: una notificación de veinte líneas no se lee. */
  const cuerpoTexto = [
    ...alertas.slice(0, 5).map(linea),
    alertas.length > 5 ? `…y ${alertas.length - 5} más` : null,
    resuelta ? null : (alertas[0]?.annotations?.description ?? '').split('\n')[0].slice(0, 220),
  ].filter(Boolean).join('\n');

  const prioridad = resuelta ? 2 : (PRIORIDAD[severidad] ?? ESCALA_SI_NO_SE_ENTIENDE);

  return {
    topic: tema,
    title: titulo,
    message: cuerpoTexto || 'Sin detalle',
    // Resuelta no urge: nunca despierta a nadie.
    priority: prioridad,
    tags: [resuelta ? 'white_check_mark' : (prioridad === 5 ? 'rotating_light' : 'warning')],
  };
}

/**
 * El servidor, SIN escuchar todavía: quien lo crea decide en qué puerto vive.
 * Separado del arranque para que las pruebas puedan levantarlo en un puerto
 * efímero contra un ntfy de mentira. Antes esto era una llamada suelta a
 * createServer().listen() y el fichero no se podía ni importar.
 */
export function crearServidor({ ntfy = NTFY, tema = TEMA } = {}) {
  return createServer((peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.writeHead(405).end(); return; }
    let crudo = '';
    peticion.on('data', (t) => { crudo += t; });
    peticion.on('end', async () => {
      try {
        const aviso = componer(JSON.parse(crudo), tema);
        /* Se publica con el TEMA dentro de un cuerpo JSON, y no con las cabeceras
           Title/Priority/Tags que ntfy también acepta, por una razón medida: los
           valores de cabecera HTTP no son UTF-8. Node los emite como bytes
           latin-1, ntfy los lee como UTF-8 y sustituye lo que no puede
           descodificar. Seis de las ocho alertas de entonces tenían tilde, y por
           cabecera llegaban así:
               «Producci\uFFFDn no responde»
           ntfy respondía 200 y Grafana daba el envío por bueno: el destrozo sólo
           se veía en la pantalla del móvil. El cuerpo sí es UTF-8 por definición,
           así que esto no evita el síntoma, elimina la clase entera. */
        const r = await fetch(`${ntfy}/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(aviso),
        });
        /* Si ntfy falla, se responde error a Grafana para que lo reintente y
           quede en SU registro: una alerta que no sale no puede desaparecer en
           silencio, que es justo lo que este canal existe para impedir. */
        respuesta.writeHead(r.ok ? 204 : 502).end();
        if (!r.ok) console.error(`ntfy respondió ${r.status} al reenviar «${aviso.title}»`);
      } catch (e) {
        console.error(`No se pudo traducir el aviso: ${e.message}`);
        respuesta.writeHead(400).end();
      }
      });
  });
}

/* Sólo arranca si se ejecuta como programa; importarlo desde una prueba no
   debe abrir ningún puerto. */
if (import.meta.url === `file://${process.argv[1]}`) {
  crearServidor().listen(PUERTO, () => console.log(`Traductor de avisos escuchando en el ${PUERTO}`));
}
