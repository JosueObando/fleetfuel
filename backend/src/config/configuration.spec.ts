import configuration from './configuration';

/*
 * Los valores por defecto de la configuración.
 *
 * Parece el fichero menos interesante del proyecto y es donde vive lo que
 * ocurre cuando FALTA una variable de entorno — que es el escenario de un
 * despliegue nuevo, un `.env` incompleto o un contenedor que arranca sin su
 * `env_file`. Un valor por defecto equivocado no da error: el sistema levanta y
 * hace algo distinto de lo que se cree.
 *
 * Cada `||` de este fichero es una decisión sobre qué pasa en ese caso, y aquí
 * se fija cuál es.
 */

const sinEntorno = <T>(fn: () => T): T => {
  const guardado = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (/^(APP_|DATABASE_|JWT_|REFRESH_|REDIS_|MFA_|LOGIN_|IDEMPOTENCIA_|SEED_|BACKEND_|PROXIES_)/.test(k)) {
      delete process.env[k];
    }
  }
  try { return fn(); } finally { process.env = guardado; }
};

describe('sin ninguna variable de entorno', () => {
  const c = () => sinEntorno(() => configuration());

  it('arranca en modo desarrollo, no en producción', () => {
    // Si el defecto fuera «production», `CifradoService` se negaría a arrancar
    // en local con el secreto de ejemplo y nadie podría levantar el proyecto.
    expect(c().env).toBe('development');
  });

  it('la base apunta a localhost y al 5433, no al 5432', () => {
    // El 5433 es deliberado: otro Postgres ocupa el 5432 en la misma máquina.
    expect(c().database.host).toBe('localhost');
    expect(c().database.port).toBe(5433);
  });

  it('el usuario de la aplicación NO es el dueño del esquema', () => {
    // Es la garantía del ADR 003: el dueño evade sus propias políticas RLS. Si
    // los dos valores por defecto coincidieran, un despliegue sin `.env`
    // arrancaría sin aislamiento entre empresas — y `main.ts` lo rechazaría,
    // que es lo correcto, pero el defecto no debe empujar ahí.
    const cfg = c();
    expect(cfg.database.user).not.toBe(cfg.database.owner);
  });

  it('los secretos por defecto GRITAN que hay que cambiarlos', () => {
    // No es cosmético: `CifradoService` se niega a arrancar en producción si el
    // secreto contiene «cambiar». Ese mecanismo depende de esta palabra.
    const cfg = c();
    expect(cfg.jwt.secret).toMatch(/cambiar/);
    expect(cfg.jwt.refreshSecret).toMatch(/cambiar/);
    expect(cfg.database.password).toMatch(/cambiar/);
  });

  it('el acceso dura 15 minutos y el refresco 7 días', () => {
    expect(c().jwt.expiresIn).toBe('15m');
    expect(c().jwt.refreshExpiresIn).toBe('7d');
  });

  it('el freno del login viene puesto, no apagado', () => {
    // Un defecto permisivo aquí dejaría el login sin freno en cualquier entorno
    // al que se le olvide una variable — que es exactamente cómo estuvo
    // producción durante horas.
    const l = c().login;
    expect(l.ventanaSegundos).toBe(60);
    expect(l.limitePorCuenta).toBe(5);
    expect(l.limitePorIp).toBe(30);
    expect(l.bloqueoSegundos).toBe(300);
  });

  it('NO se confía en ningún proxy por defecto', () => {
    // Vacío significa «usa la IP del socket». Cualquier otro defecto haría que
    // un despliegue sin configurar aceptara el X-Forwarded-For de cualquiera, y
    // entonces todo el mundo podría falsificar su IP en la auditoría.
    expect(c().proxiesDeConfianza).toBe('');
  });

  it('la idempotencia recuerda 24 horas', () => {
    expect(c().idempotencia.ttlHoras).toBe(24);
  });
});

describe('con el entorno puesto, manda el entorno', () => {
  it('cada variable pisa su valor por defecto', () => {
    const previo = { ...process.env };
    Object.assign(process.env, {
      APP_ENV: 'production', DATABASE_HOST: 'db', DATABASE_PORT: '5432',
      DATABASE_APP_USER: 'otro_app', JWT_SECRET: 'secreto-de-verdad',
      LOGIN_LIMITE_CUENTA: '9', PROXIES_DE_CONFIANZA: '10.0.0.19',
      IDEMPOTENCIA_TTL_HORAS: '48',
    });
    try {
      const c = configuration();
      expect(c.env).toBe('production');
      expect(c.database.host).toBe('db');
      expect(c.database.port).toBe(5432);
      expect(c.database.user).toBe('otro_app');
      expect(c.jwt.secret).toBe('secreto-de-verdad');
      expect(c.login.limitePorCuenta).toBe(9);
      expect(c.proxiesDeConfianza).toBe('10.0.0.19');
      expect(c.idempotencia.ttlHoras).toBe(48);
    } finally { process.env = previo; }
  });

  it('los números llegan como número, no como texto', () => {
    // `parseInt` en cada uno: sin él, `port` sería la cadena "5432" y la
    // comparación con un número fallaría en sitios que nadie mira.
    const previo = { ...process.env };
    process.env.DATABASE_PORT = '5555';
    try {
      expect(typeof configuration().database.port).toBe('number');
    } finally { process.env = previo; }
  });
});
