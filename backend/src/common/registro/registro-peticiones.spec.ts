import { recortar } from './registro-peticiones.middleware';

/*
 * El registro de este backend es UNA línea JSON por petición, y Promtail la
 * analiza como tal. Lo que se prueba aquí es que esa línea siga siendo legible
 * cuando el cliente no colabora.
 *
 * Ninguna prueba de integración tocaba el recorte: supertest manda un
 * `user-agent` corto, así que la rama del agente largo —la del bot, que es
 * justo el tráfico que uno va a mirar en Grafana— nunca se ejecutaba.
 */
describe('recortar · que una línea de registro siga siendo legible', () => {
  it('deja pasar un agente normal sin tocarlo', () => {
    const agente = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';
    expect(recortar(agente)).toBe(agente);
  });

  it('recorta el agente larguísimo y marca que se recortó', () => {
    const recortado = recortar('a'.repeat(500));
    // 160 caracteres más el puntito: la marca importa tanto como el recorte,
    // porque sin ella una cadena truncada parece una cadena completa.
    expect(recortado).toHaveLength(161);
    expect(recortado?.endsWith('…')).toBe(true);
  });

  it('en el límite exacto no recorta: 160 cabe', () => {
    expect(recortar('a'.repeat(160))).toHaveLength(160);
    expect(recortar('a'.repeat(161))).toHaveLength(161);
  });

  it('sin agente no inventa una cadena vacía', () => {
    // `JSON.stringify` omite las claves con `undefined`: una petición sin
    // agente no arrastra un campo vacío a la línea.
    expect(recortar(undefined)).toBeUndefined();
    expect(recortar('')).toBeUndefined();
  });
});
