export default () => ({
  env: process.env.APP_ENV || 'development',
  port: parseInt(process.env.BACKEND_PORT || '4100', 10),
  database: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5433', 10),
    name: process.env.DATABASE_NAME || 'fleetfuel_db',
    // Dueño del esquema: sólo migraciones y seeds.
    owner: process.env.DATABASE_USER || 'fleetfuel_owner',
    ownerPassword: process.env.DATABASE_PASSWORD || 'cambiar_en_produccion',
    // Rol de la aplicación: sujeto a RLS y sin DELETE (ver la migración base).
    user: process.env.DATABASE_APP_USER || 'fleetfuel_app',
    password: process.env.DATABASE_APP_PASSWORD || 'cambiar_en_produccion_app',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'cambiar_este_secreto_en_produccion',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.REFRESH_TOKEN_SECRET || 'cambiar_este_secreto_de_refresco',
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6380', 10),
  },
  mfa: {
    emisor: process.env.MFA_EMISOR || 'FleetFuel Control',
    // §7: TOTP obligatorio para Administrador, Finanzas y Auditor.
    rolesObligatorios: (process.env.MFA_ROLES_OBLIGATORIOS || 'Administrador,Finanzas,Auditor')
      .split(',').map((r) => r.trim()).filter(Boolean),
  },
  idempotencia: {
    ttlHoras: parseInt(process.env.IDEMPOTENCIA_TTL_HORAS || '24', 10),
  },
  seed: {
    empresaNombre: process.env.SEED_EMPRESA_NOMBRE || 'Alcaldía de Panamá',
    empresaRuc: process.env.SEED_EMPRESA_RUC || '8-NT-1-000',
    adminCorreo: process.env.SEED_ADMIN_CORREO || 'admin@mupa.gob.pa',
    adminClave: process.env.SEED_ADMIN_CLAVE || 'Admin12345*',
  },
});
