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

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * De dónde sale la versión que anuncia `/api/salud`.
 *
 * `npm_package_version` sólo existe cuando el proceso lo lanzó npm. Jest lo
 * lanza, así que en las pruebas SIEMPRE está — y la rama de reserva, la que lee
 * `package.json`, era la única que nunca se ejecutaba aquí.
 *
 * Y es la única que se ejecuta en PRODUCCIÓN: la imagen arranca con
 * `node dist/main.js`, sin npm delante. O sea que el único camino que corre de
 * verdad era el único sin probar, y romperlo no habría fallado en CI: habría
 * salido como un `"version": "desconocida"` en el chequeo de salud que nadie
 * lee hasta que hace falta.
 *
 * El módulo se recarga a propósito: `VERSION` se resuelve UNA vez al importar,
 * que es lo correcto —no se relee el disco en cada petición— y obliga a
 * reimportar para probar la otra rama.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('la versión que se anuncia, según cómo se arrancó el proceso', () => {
  const original = process.env.npm_package_version;

  afterEach(() => {
    if (original === undefined) delete process.env.npm_package_version;
    else process.env.npm_package_version = original;
    jest.resetModules();
  });

  /** Recarga el módulo y devuelve la versión que anunciaría. */
  async function versionAnunciada(): Promise<string> {
    let anunciada = '';
    await jest.isolateModulesAsync(async () => {
      const { SaludService: Recargado } = await import('./salud.service');
      anunciada = (await new Recargado(dsCon(bien), redisCon(bien)).revisar()).version;
    });
    return anunciada;
  }

  it('bajo npm toma la variable de entorno', async () => {
    process.env.npm_package_version = '9.9.9-de-prueba';
    expect(await versionAnunciada()).toBe('9.9.9-de-prueba');
  });

  it('sin npm —como en producción— la lee del package.json', async () => {
    delete process.env.npm_package_version;
    const anunciada = await versionAnunciada();
    expect(anunciada).not.toBe('desconocida');
    expect(anunciada).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('si el package.json no se puede leer, lo dice en vez de reventar', async () => {
    // Un chequeo de salud que se cae porque no encuentra su propia versión
    // convierte un detalle cosmético en una caída. Aquí degrada a una palabra.
    delete process.env.npm_package_version;
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue('/no/existe/este/camino');
    try {
      expect(await versionAnunciada()).toBe('desconocida');
    } finally {
      cwd.mockRestore();
    }
  });
});
