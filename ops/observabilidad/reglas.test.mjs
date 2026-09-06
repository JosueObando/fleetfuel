import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PRIORIDAD, componer } from './aviso/servidor.mjs';

/*
 * CONTRATO entre las reglas de Grafana y el traductor que las convierte en
 * notificación.
 *
 * Existe porque las dos piezas se editan por separado y nada las ata: el
 * traductor sabe leer `severidad: critico` y `severidad: aviso`, y hoy las ocho
 * reglas usan exactamente esas dos por coincidencia sostenida por nada. Una
 * regla nueva con `severidad: urgente` seguiría funcionando —Grafana la
 * dispararía, el traductor la entregaría— pero con la prioridad equivocada y
 * sin error en ningún sitio. Un canal de alertas que se degrada en silencio es
 * el peor de los fallos posibles, porque parece que está.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const yaml = (n) => readFileSync(join(AQUI, n), 'utf8');

/*
 * Extracción por líneas, no un analizador de YAML completo: sólo hacen falta
 * cuatro campos y meter una dependencia en `ops/` por esto sería peor. El
 * riesgo de un análisis a mano es que deje de encontrar nada y pase en verde
 * por vacío, así que lo PRIMERO que se afirma es el número de reglas.
 */
function reglas() {
  const texto = yaml('grafana/alertas/reglas.yml');
  return texto.split('\n  - uid: ').slice(1).map((bloque) => ({
    uid: bloque.split('\n')[0].trim(),
    title: (bloque.match(/\n {4}title: (.+)/) ?? [])[1]?.trim(),
    severidad: (bloque.match(/\n {6}severidad: (\S+)/) ?? [])[1],
    summary: (bloque.match(/\n {6}summary: /) ?? [])[0],
    description: (bloque.match(/\n {6}description: /) ?? [])[0],
  }));
}

describe('las reglas de alerta y el traductor hablan el mismo idioma', () => {
  test('se leen las ocho reglas (si esto falla, el resto del fichero miente)', () => {
    // La red bajo la extracción a mano: cualquier cambio de forma del YAML que
    // deje de encajar aparece aquí y no como una suite que pasa sin mirar nada.
    const encontradas = reglas();
    assert.equal(encontradas.length, 8);
    assert.equal(encontradas.length, yaml('grafana/alertas/reglas.yml').match(/\n {2}- uid: /g).length);
  });

  test('toda regla declara una severidad que el traductor entiende', () => {
    const conocidas = Object.keys(PRIORIDAD);
    for (const r of reglas()) {
      assert.ok(r.severidad, `${r.uid} no declara severidad`);
      assert.ok(conocidas.includes(r.severidad),
        `${r.uid} usa «${r.severidad}», que el traductor no conoce: llegaría con la prioridad de escalada, no con la suya. Conocidas: ${conocidas.join(', ')}`);
    }
  });

  test('toda regla trae el summary y la description de los que vive la notificación', () => {
    // El summary es el primer renglón del mensaje y la description el segundo:
    // sin ellos llega el nombre técnico de la regla y nada que hacer.
    for (const r of reglas()) {
      assert.ok(r.summary, `${r.uid} no tiene summary: la notificación llegaría con el alertname a secas`);
      assert.ok(r.description, `${r.uid} no tiene description: la notificación no diría por dónde empezar`);
    }
  });

  test('ninguna regla se queda sin título, que es lo que se lee primero', () => {
    for (const r of reglas()) assert.ok(r.title?.length > 3, `${r.uid} sin título legible`);
  });

  test('los títulos con tilde sobreviven el viaje entero', () => {
    // La regresión del fallo real: seis de los ocho títulos llevan tilde y
    // llegaban rotos. Se comprueba con los títulos DE VERDAD, no inventados.
    const conTilde = reglas().filter((r) => /[^\x00-\x7F]/.test(r.title));
    assert.ok(conTilde.length >= 5, 'se esperaban varios títulos con tilde; ¿se renombraron las reglas?');
    for (const r of conTilde) {
      const viajado = JSON.parse(JSON.stringify(
        componer({ status: 'firing', groupLabels: { alertname: r.title }, alerts: [] }, 'tema')));
      assert.equal(viajado.title, r.title);
    }
  });
});

describe('el aviso sale por el traductor y no directo a ntfy', () => {
  test('el punto de contacto apunta al traductor', () => {
    // Si alguien lo vuelve a apuntar a ntfy, la entrega sigue «funcionando»
    // pero al móvil llega el JSON crudo de Grafana. Medido, y por eso se fija.
    const contactos = yaml('grafana/alertas/contactos.yml');
    assert.match(contactos, /url: http:\/\/aviso:8080/);
    assert.ok(!/url: http:\/\/ntfy/.test(contactos), 'hay un contacto apuntando directo a ntfy');
  });

  test('el receptor por defecto es ese, y no queda ninguna alerta sin ruta', () => {
    assert.match(yaml('grafana/alertas/contactos.yml'), /receiver: ntfy/);
  });
});
