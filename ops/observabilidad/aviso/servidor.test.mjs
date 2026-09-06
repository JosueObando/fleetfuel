import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { componer, crearServidor } from './servidor.mjs';

/*
 * RECORRIDOS que estas pruebas defienden
 *
 * Como responsable del sistema, quiero que una alerta crítica llegue a mi móvil
 * con el título íntegro y sonando aunque el teléfono esté en silencio, para
 * poder actuar sin abrir Grafana — que es justo lo que no voy a poder abrir si
 * lo que se ha caído es producción.
 *
 * Como responsable, quiero que la resolución llegue sin despertarme, para que
 * el canal no se me haga insoportable. Un canal silenciado es peor que no
 * tenerlo, porque parece que está.
 *
 * Como responsable, quiero que un aviso que no se puede entregar deje rastro en
 * alguna parte, para que ninguna alerta desaparezca en silencio.
 */

/** Un aviso de Grafana con la forma real que manda su webhook. */
const avisoDe = (extra = {}) => ({
  status: 'firing',
  groupLabels: { alertname: 'Producción no responde' },
  alerts: [{
    labels: { severidad: 'critico' },
    annotations: {
      summary: 'La sonda contra https://fleetfuel.jop.lat falla',
      description: 'Empezar por: curl -sf https://fleetfuel.jop.lat/api/salud\nY luego mirar el cortafuegos.',
    },
  }],
  ...extra,
});

describe('componer · el texto que llega al móvil', () => {
  test('el título conserva las tildes después de viajar como JSON', () => {
    // EL FALLO QUE MOTIVA ESTE FICHERO. El título viajaba en una cabecera HTTP,
    // que no es UTF-8, y llegaba «Producci<?>n no responde» con ntfy
    // respondiendo 200. Se comprueba sobre el JSON serializado y vuelto a
    // leer, que es el transporte de verdad: comprobarlo sobre el objeto en
    // memoria no habría detectado nada.
    const viajado = JSON.parse(JSON.stringify(componer(avisoDe(), 'tema')));
    assert.equal(viajado.title, 'Producción no responde');
  });

  test('una crítica suena: prioridad 5 y sirena', () => {
    const a = componer(avisoDe(), 'tema');
    assert.equal(a.priority, 5);
    assert.deepEqual(a.tags, ['rotating_light']);
  });

  test('un aviso no despierta a nadie: prioridad 3', () => {
    const cuerpo = avisoDe();
    cuerpo.alerts[0].labels.severidad = 'aviso';
    assert.equal(componer(cuerpo, 'tema').priority, 3);
  });

  test('el primer renglón dice QUÉ pasa y el segundo por dónde empezar', () => {
    const a = componer(avisoDe(), 'tema');
    assert.deepEqual(a.message.split('\n'), [
      'La sonda contra https://fleetfuel.jop.lat falla',
      'Empezar por: curl -sf https://fleetfuel.jop.lat/api/salud',
    ]);
  });

  test('el tema es el que se le pasa, no uno fijo', () => {
    assert.equal(componer(avisoDe(), 'fleetfuel-abc123').topic, 'fleetfuel-abc123');
  });
});

describe('componer · la resolución', () => {
  const resuelta = () => componer(avisoDe({ status: 'resolved' }), 'tema');

  test('se anuncia como resuelta en el título', () => {
    assert.equal(resuelta().title, 'Resuelta: Producción no responde');
  });

  test('no despierta a nadie aunque la alerta fuera crítica', () => {
    assert.equal(resuelta().priority, 2);
    assert.deepEqual(resuelta().tags, ['white_check_mark']);
  });

  test('no repite las instrucciones, que ya no sirven de nada', () => {
    assert.ok(!resuelta().message.includes('curl -sf'));
  });
});

describe('componer · los casos que sólo ocurren cuando algo va raro', () => {
  test('una severidad que el traductor no conoce ESCALA a crítica', () => {
    // Decisión deliberada, y es la contraria a la que tenía. Ante una etiqueta
    // ilegible los dos errores no cuestan lo mismo: escalar de más molesta,
    // escalar de menos silencia una caída. Una alerta cuya gravedad no se sabe
    // leer es, por definición, una que nadie ha triado.
    // La otra mitad de esta defensa está en reglas.test.mjs, que impide que una
    // severidad desconocida llegue siquiera a existir.
    const cuerpo = avisoDe();
    cuerpo.alerts[0].labels.severidad = 'urgentísimo';
    assert.equal(componer(cuerpo, 'tema').priority, 5);
  });

  test('sin etiqueta de severidad, también escala', () => {
    const cuerpo = avisoDe();
    delete cuerpo.alerts[0].labels.severidad;
    assert.equal(componer(cuerpo, 'tema').priority, 5);
  });

  test('un grupo de más de cinco se resume en vez de llenar la pantalla', () => {
    const cuerpo = avisoDe({
      alerts: Array.from({ length: 9 }, (_, i) => ({
        labels: { severidad: 'aviso' }, annotations: { summary: `alerta ${i}` },
      })),
    });
    const renglones = componer(cuerpo, 'tema').message.split('\n');
    assert.deepEqual(renglones.slice(0, 5), ['alerta 0', 'alerta 1', 'alerta 2', 'alerta 3', 'alerta 4']);
    assert.equal(renglones[5], '…y 4 más');
  });

  test('una alerta sin summary cae en su nombre, no en un hueco', () => {
    const cuerpo = avisoDe();
    cuerpo.alerts[0].annotations = {};
    cuerpo.alerts[0].labels.alertname = 'ff-disco-lleno';
    assert.equal(componer(cuerpo, 'tema').message, 'ff-disco-lleno');
  });

  test('un aviso sin ninguna alerta dentro no revienta ni llega vacío', () => {
    const a = componer({ status: 'firing', alerts: [] }, 'tema');
    assert.equal(a.message, 'Sin detalle');
    assert.equal(a.title, 'Alerta');
  });
});

/** Levanta un ntfy de mentira y el traductor apuntando a él. */
async function conNtfyFalso(responder) {
  const recibido = [];
  const ntfy = createServer((peticion, respuesta) => {
    let crudo = '';
    peticion.on('data', (t) => { crudo += t; });
    peticion.on('end', () => {
      /* Responde SIEMPRE, encaje o no el cuerpo. La primera versión hacía
         JSON.parse aquí y, ante un cuerpo que no lo era, moría antes de
         contestar: el traductor se quedaba esperando y la prueba colgaba para
         siempre en vez de fallar. Se descubrió mutando el código a propósito.
         Un arnés que cuelga convierte un fallo detectado en un CI agotado. */
      let cuerpo;
      try { cuerpo = JSON.parse(crudo); } catch { cuerpo = { crudo }; }
      recibido.push(cuerpo);
      responder(respuesta);
    });
  });
  ntfy.listen(0); await once(ntfy, 'listening');

  const traductor = crearServidor({ ntfy: `http://127.0.0.1:${ntfy.address().port}`, tema: 'tema' });
  traductor.listen(0); await once(traductor, 'listening');

  return {
    recibido,
    url: `http://127.0.0.1:${traductor.address().port}`,
    async cerrar() { traductor.close(); ntfy.close(); await Promise.all([once(traductor, 'close'), once(ntfy, 'close')]); },
  };
}

describe('el traductor entero, contra un ntfy de mentira', () => {
  test('traduce el webhook de Grafana y responde 204', { timeout: 5000 }, async () => {
    const s = await conNtfyFalso((r) => r.writeHead(200).end());
    try {
      const r = await fetch(s.url, { method: 'POST', body: JSON.stringify(avisoDe()) });
      assert.equal(r.status, 204);
      // Se afirma sobre el cuerpo que ntfy recibe: tiene que ser JSON con el
      // título dentro. Si alguien devuelve el título a una cabecera HTTP, aquí
      // llega texto suelto y esto falla — que es el punto.
      assert.deepEqual(Object.keys(s.recibido[0]).sort(), ['message', 'priority', 'tags', 'title', 'topic']);
      assert.equal(s.recibido[0].title, 'Producción no responde');
      assert.equal(s.recibido[0].topic, 'tema');
    } finally { await s.cerrar(); }
  });

  test('si ntfy falla responde 502, para que Grafana reintente y quede en su registro', { timeout: 5000 }, async () => {
    // Es LA propiedad del canal: una alerta que no sale no puede desaparecer
    // en silencio. Devolver 204 aquí haría que Grafana la diera por entregada.
    const s = await conNtfyFalso((r) => r.writeHead(507).end());
    try {
      const r = await fetch(s.url, { method: 'POST', body: JSON.stringify(avisoDe()) });
      assert.equal(r.status, 502);
    } finally { await s.cerrar(); }
  });

  test('un cuerpo que no es JSON se rechaza con 400 y no tumba el traductor', { timeout: 5000 }, async () => {
    const s = await conNtfyFalso((r) => r.writeHead(200).end());
    try {
      assert.equal((await fetch(s.url, { method: 'POST', body: 'esto no es json' })).status, 400);
      // Y sigue en pie para el siguiente aviso, que es lo que importa.
      assert.equal((await fetch(s.url, { method: 'POST', body: JSON.stringify(avisoDe()) })).status, 204);
    } finally { await s.cerrar(); }
  });

  test('un GET no se confunde con un aviso', { timeout: 5000 }, async () => {
    const s = await conNtfyFalso((r) => r.writeHead(200).end());
    try {
      assert.equal((await fetch(s.url)).status, 405);
      assert.equal(s.recibido.length, 0);
    } finally { await s.cerrar(); }
  });
});
