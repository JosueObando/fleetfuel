import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { SaludService } from './salud.service';

const dsCon = (fn: () => Promise<unknown>) => ({ query: fn }) as unknown as DataSource;
const redisCon = (fn: () => Promise<unknown>) => ({ ping: fn }) as unknown as Redis;
const bien = () => Promise.resolve('ok');
const mal = () => Promise.reject(new Error('ECONNREFUSED 10.0.0.193:5433'));

describe('SaludService', () => {
  // El log de error es ruido esperado en las pruebas de fallo.
  beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));

  it('informa ok cuando las dos dependencias responden', async () => {
    const salud = await new SaludService(dsCon(bien), redisCon(bien)).revisar();
    expect(salud.estado).toBe('ok');
    expect(salud.dependencias).toEqual({ postgres: 'ok', redis: 'ok' });
  });

  it('degrada cuando Postgres no responde', async () => {
    const salud = await new SaludService(dsCon(mal), redisCon(bien)).revisar();
    expect(salud.estado).toBe('degradado');
    expect(salud.dependencias.postgres).toBe('caida');
    expect(salud.dependencias.redis).toBe('ok');
  });

  it('degrada cuando Redis no responde', async () => {
    const salud = await new SaludService(dsCon(bien), redisCon(mal)).revisar();
    expect(salud.estado).toBe('degradado');
    expect(salud.dependencias.redis).toBe('caida');
  });

  // Lo que separa un chequeo útil de uno inútil: si la base se cuelga sin
  // cerrar la conexión, esto tiene que responder igual. Un monitor esperando
  // para siempre no reporta nada.
  it('no se cuelga cuando una dependencia deja de responder', async () => {
    jest.useFakeTimers();
    const colgada = () => new Promise<unknown>(() => undefined);
    const promesa = new SaludService(dsCon(colgada), redisCon(bien)).revisar();
    await jest.advanceTimersByTimeAsync(2500);
    const salud = await promesa;
    expect(salud.dependencias.postgres).toBe('caida');
    jest.useRealTimers();
  });

  // No se filtra el motivo hacia afuera: el mensaje de error trae host y puerto.
  it('no expone el detalle del fallo en la respuesta', async () => {
    const salud = await new SaludService(dsCon(mal), redisCon(bien)).revisar();
    expect(JSON.stringify(salud)).not.toMatch(/ECONNREFUSED|10\.0\.0\.193/);
  });
});
