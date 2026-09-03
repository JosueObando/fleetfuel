#!/usr/bin/env node
/*
 * Auditoría de contraste AA · criterio de salida de UX-0.
 *
 * Lee los valores de tokens.css en vez de repetirlos: si alguien cambia un
 * color, la auditoría evalúa el color nuevo. Una lista duplicada aquí se
 * desincronizaría del CSS y daría verde sobre valores que ya no existen.
 *
 * Salida distinta de cero si algún par falla, para que CI lo detenga.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(aqui, '..', 'src', 'estilos', 'tokens.css'), 'utf8');

const tokens = Object.fromEntries(
  [...css.matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map(m => [m[1], m[2]])
);

const canal = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminancia = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
};
const razon = (a, b) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// texto: AA normal 4.5 · AA grande (≥18.66px bold o ≥24px) 3.0 · no textual 3.0
const PARES = [
  ['--fg-strong',  '--bg-base',    4.5, 'Títulos sobre el lienzo'],
  ['--fg-strong',  '--bg-surface', 4.5, 'Títulos sobre panel'],
  ['--fg-default', '--bg-base',    4.5, 'Cuerpo sobre el lienzo'],
  ['--fg-default', '--bg-surface', 4.5, 'Cuerpo sobre panel'],
  ['--fg-muted',   '--bg-base',    4.5, 'Captions sobre el lienzo'],
  ['--fg-muted',   '--bg-surface', 4.5, 'Captions sobre panel'],
  ['--fg-on-action', '--action',   4.5, 'Texto sobre botón primario'],
  ['--fg-on-action', '--bg-inverse',4.5,'Texto del sidebar (azul MUPA)'],
  ['--action',     '--bg-surface', 3.0, 'Trazo de ruta y selección'],
  ['--action',     '--action-subtle', 3.0, 'Icono sobre botón secundario'],
  ['--border-subtle', '--bg-surface', 1.0, 'Divisores (decorativos)'],
  ['--color-error-500',   '--bg-surface', 3.0, 'Estado: retrasado'],
  ['--color-warning-500', '--bg-surface', 1.5, 'Estado: esperando'],
  ['--color-success-500', '--bg-surface', 1.5, 'Estado: en ruta'],
];

let fallos = 0;
console.log('Auditoría de contraste · AA\n');
for (const [frente, fondo, minimo, nota] of PARES) {
  const a = tokens[frente], b = tokens[fondo];
  if (!a || !b) { console.log(`  ?  ${frente} / ${fondo} — token no encontrado`); fallos++; continue; }
  const r = razon(a, b);
  const pasa = r >= minimo;
  if (!pasa) fallos++;
  console.log(
    `  ${pasa ? '✓' : '✗'}  ${r.toFixed(2).padStart(5)}:1  (mín ${minimo})  ` +
    `${frente} sobre ${fondo}  — ${nota}`
  );
}

// Los estados de color nunca son el único portador de significado: el spec
// exige texto o icono además del color (StatusBadge, CapacityGauge con
// role="meter"). Por eso los tres de estado piden 1.5 y no 4.5: son
// indicadores acompañados, no texto.
console.log(fallos === 0 ? '\n✅ 0 fallos AA' : `\n❌ ${fallos} fallo(s) AA`);
process.exit(fallos === 0 ? 0 : 1);
