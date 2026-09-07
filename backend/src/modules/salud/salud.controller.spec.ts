import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { SaludController } from './salud.controller';
import type { Salud, SaludService } from './salud.service';

/*
 * La traducción de «degradado» a 503 es el eslabón del que cuelga TODA la
 * cadena de vigilancia externa: la sonda de blackbox pide esta ruta por la
 * misma URL que un usuario, y la alerta ff-produccion-caida se dispara por el
 * código de estado. Si el controlador devolviera 200 con un cuerpo que dice
 * «degradado», la sonda vería el sistema sano con la base caída, y la alerta
 * más importante del sistema no saltaría nunca.
 *
 * El servicio ya estaba probado en salud.spec.ts. Lo que faltaba era esto: la
 * única línea que convierte su diagnóstico en algo que un monitor entiende.
 */

const SALUD = (estado: Salud['estado'], postgres: 'ok' | 'caida' = 'ok'): Salud => ({
  estado,
  servicio: 'FleetFuel Control · API',
  version: '1.0.0',
  tiempoActivoSegundos: 42,
  dependencias: { postgres, redis: 'ok' },
});

function respuestaFalsa() {
  const estados: number[] = [];
  return { res: { status: (c: number) => { estados.push(c); return null; } } as unknown as Response, estados };
}

const controladorCon = (salud: Salud) =>
  new SaludController({ revisar: () => Promise.resolve(salud) } as unknown as SaludService);

describe('SaludController', () => {
  it('responde 200 cuando todo está sano', async () => {
    const { res, estados } = respuestaFalsa();
    await controladorCon(SALUD('ok')).revisar(res);
    expect(estados).toEqual([HttpStatus.OK]);
  });

  it('responde 503 —no 200— cuando una dependencia está caída', async () => {
    // Es LA prueba de este fichero. Un 200 con «degradado» dentro es un sistema
    // caído que se anuncia sano a todo el que mira el código de estado.
    const { res, estados } = respuestaFalsa();
    await controladorCon(SALUD('degradado', 'caida')).revisar(res);
    expect(estados).toEqual([HttpStatus.SERVICE_UNAVAILABLE]);
  });

  it('devuelve el diagnóstico completo en el cuerpo, no sólo el código', async () => {
    // El código de estado es para el monitor; el cuerpo, para quien lo abre a
    // mano y necesita saber CUÁL de las dos dependencias se cayó.
    const { res } = respuestaFalsa();
    const cuerpo = await controladorCon(SALUD('degradado', 'caida')).revisar(res);
    expect(cuerpo.dependencias).toEqual({ postgres: 'caida', redis: 'ok' });
  });
});
