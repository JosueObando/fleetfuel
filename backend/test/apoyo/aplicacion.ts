import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { hash } from 'bcryptjs';
import { COSTO_BCRYPT } from '../../src/common/costo-bcrypt';
import Redis from 'ioredis';

cargarEnv({ path: join(__dirname, '../../../.env') });

/**
 * Arranque compartido para las pruebas que necesitan la aplicación DE VERDAD.
 *
 * Levanta el AppModule completo contra el Postgres y el Redis reales, no un
 * doble. Es la única forma de que las pruebas ejerciten lo que de verdad decide
 * el comportamiento: los guards globales, el interceptor de contexto que abre
 * la transacción y fija `app.empresa_id`, el de idempotencia, el de auditoría y
 * el freno del login. Un `AuthService` construido a mano con dobles no pasa por
 * ninguno de ellos, y son justo la mitad del sistema.
 */

export const conexionDueño = () => new DataSource({
  type: 'postgres' as const,
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5433', 10),
  database: process.env.DATABASE_NAME || 'fleetfuel_db',
  username: process.env.DATABASE_USER || 'fleetfuel_owner',
  password: process.env.DATABASE_PASSWORD || 'cambiar_en_produccion',
});

export const conexionRedis = () => new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6380', 10),
  maxRetriesPerRequest: 3,
});

/**
 * Borra los contadores del freno del login.
 *
 * Sin esto las pruebas dejan de ser independientes: el freno cuenta por (IP,
 * cuenta) y por IP, y todas las peticiones de supertest salen de la misma
 * dirección. A partir de la sexta petición fallida la prueba siguiente recibe
 * un 429 que no tiene nada que ver con lo que estaba probando — y el síntoma
 * es una prueba que falla sólo cuando se corre junto a otras.
 */
export async function limpiarFreno(redis: Redis): Promise<void> {
  const claves = await redis.keys('freno:*');
  if (claves.length) await redis.del(...claves);
}

export interface UsuarioDePrueba {
  id: string;
  correo: string;
  clave: string;
}

/** Crea una empresa con un usuario que puede iniciar sesión de verdad. */
export async function sembrarEmpresa(
  dueño: DataSource,
  opciones: { ruc: string; correo: string; clave?: string; mfa?: boolean; estado?: string } ,
): Promise<{ empresa: string; usuario: UsuarioDePrueba }> {
  const clave = opciones.clave ?? 'ClaveDePrueba123';
  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ($1,$2)
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`,
    [`Empresa ${opciones.ruc}`, opciones.ruc]);
  const empresa = String(e.empresa_id);

  const [u] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave, estado, mfa_habilitado)
     VALUES ($1,'Usuario Prueba',$2,$3,$4,$5) RETURNING usuario_id`,
    // Con el mismo coste que en producción: con coste 10 el usuario de prueba
    // se compararía cuatro veces más rápido que el hash de descarte, y la
    // prueba de tiempos fallaría por el andamiaje y no por el código.
    [empresa, opciones.correo, await hash(clave, COSTO_BCRYPT), opciones.estado ?? 'activo', opciones.mfa ?? false]);

  return { empresa, usuario: { id: String(u.usuario_id), correo: opciones.correo, clave } };
}

/** Deja la base como estaba. El orden importa: las claves foráneas mandan. */
export async function borrarEmpresa(dueño: DataSource, empresa: string, ruc: string): Promise<void> {
  for (const t of ['intentos_login', 'auditoria', 'claves_idempotencia', 'dispositivos',
                   'plan_carga', 'viaje_ordenes', 'viajes', 'detalles_orden',
                   'ordenes_abastecimiento', 'estaciones_servicio', 'clientes',
                   'productos_combustible', 'compartimentos_cisterna', 'cisternas',
                   'vehiculos', 'conductores', 'usuarios_roles', 'roles_permisos',
                   'roles', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]).catch(() => undefined);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = $1`, [ruc]);
}

/**
 * Da al usuario un rol con los permisos indicados (o con todos, si no se dicen).
 *
 * Los permisos son globales y los roles por empresa: es lo que permite que una
 * operadora invente el rol «Despachador de noche» sin tocar el catálogo.
 */
export async function darPermisos(
  dueño: DataSource,
  datos: { empresa: string; usuarioId: string; nombreRol?: string; codigos?: string[]; exigeMfa?: boolean },
): Promise<string> {
  const [r] = await dueño.query(
    `INSERT INTO roles (empresa_id, nombre, exige_mfa) VALUES ($1,$2,$3) RETURNING rol_id`,
    [datos.empresa, datos.nombreRol ?? 'Rol de prueba', datos.exigeMfa ?? false]);

  await dueño.query(
    `INSERT INTO roles_permisos (rol_id, permiso_id)
     SELECT $1, permiso_id FROM permisos WHERE ($2::text[] IS NULL OR codigo = ANY($2))`,
    [r.rol_id, datos.codigos ?? null]);

  await dueño.query(`INSERT INTO usuarios_roles (usuario_id, rol_id) VALUES ($1,$2)`,
    [datos.usuarioId, r.rol_id]);
  return String(r.rol_id);
}
