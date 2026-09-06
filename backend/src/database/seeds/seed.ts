import 'reflect-metadata';
import { hash } from 'bcryptjs';
import { COSTO_BCRYPT } from '../../common/costo-bcrypt';
import { aplicarReparto } from '../reparto-permisos';
import { AppDataSource } from '../data-source';

/**
 * Siembra la empresa operadora, los 12 roles del §5 del PRD y el administrador
 * inicial. Corre como DUEÑO del esquema — la RLS no deja crear la primera
 * empresa desde dentro de un contexto de empresa que aún no existe.
 *
 * Es idempotente: se puede volver a correr sobre una base ya sembrada.
 */

/**
 * Los 12 roles del §5, con su identidad: nombre, para qué son, y si exigen
 * segundo factor.
 *
 * QUÉ permisos tiene cada uno ya NO se decide aquí, sino en
 * `reparto-permisos.ts`. Estaba repartido entre este fichero y dos migraciones,
 * y esa división fue el fallo: las migraciones reparten buscando el rol por
 * nombre, y en una base nueva corren antes de que la semilla lo cree. No
 * encontraban nada y no fallaban.
 */
const ROLES: Array<{ nombre: string; descripcion: string; exigeMfa: boolean }> = [
  { nombre: 'Administrador', exigeMfa: true,
    descripcion: 'Configuración general, usuarios, permisos, catálogos y auditoría' },
  { nombre: 'Finanzas', exigeMfa: true,
    descripcion: 'Revisa costos, rentabilidad y pagos a conductores' },
  { nombre: 'Auditor', exigeMfa: true,
    descripcion: 'Consulta historial, documentos y trazabilidad sin modificar datos' },
  { nombre: 'Operador de órdenes', exigeMfa: false,
    descripcion: 'Registra o importa órdenes de Terpelo' },
  { nombre: 'Planificador de flota', exigeMfa: false,
    descripcion: 'Asigna cisterna, compartimentos, conductor y horario' },
  { nombre: 'Despachador', exigeMfa: false,
    descripcion: 'Autoriza salida y verifica documentos' },
  { nombre: 'Conductor', exigeMfa: false,
    descripcion: 'Consulta viajes, registra eventos, gastos y evidencias' },
  // §7: la separación entre quien captura la carga y quien captura la entrega
  // es un control antifraude, no un detalle organizativo. Por eso son dos roles
  // distintos y ninguno hereda del otro — y por eso no existe un rol con paso
  // libre que pudiera reunir ambos sin dejar rastro.
  { nombre: 'Operador de carga', exigeMfa: false,
    descripcion: 'Confirma volúmenes cargados y sellos' },
  { nombre: 'Responsable de estación', exigeMfa: false,
    descripcion: 'Valida recepción y firma entrega' },
  { nombre: 'Supervisor de operaciones', exigeMfa: false,
    descripcion: 'Monitorea rutas, retrasos, alertas y diferencias' },
  { nombre: 'Mantenimiento', exigeMfa: false,
    descripcion: 'Gestiona servicios preventivos y reparaciones' },
  { nombre: 'Cliente externo', exigeMfa: false,
    descripcion: 'Consulta órdenes y entregas autorizadas' },
];

async function sembrar() {
  await AppDataSource.initialize();
  const q = AppDataSource.manager;

  const nombreEmpresa = process.env.SEED_EMPRESA_NOMBRE || 'Alcaldía de Panamá';
  const ruc = process.env.SEED_EMPRESA_RUC || '8-NT-1-000';
  const correo = process.env.SEED_ADMIN_CORREO || 'admin@mupa.gob.pa';
  const clave = process.env.SEED_ADMIN_CLAVE || 'Admin12345*';

  const [empresa] = await q.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ($1,$2)
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING empresa_id`,
    [nombreEmpresa, ruc],
  );
  const empresaId = empresa.empresa_id;

  const rolesPorNombre = new Map<string, string>();
  for (const rol of ROLES) {
    const [creado] = await q.query(
      `INSERT INTO roles (empresa_id, nombre, descripcion, exige_mfa) VALUES ($1,$2,$3,$4)
       ON CONFLICT (empresa_id, nombre) DO UPDATE SET descripcion = EXCLUDED.descripcion
       RETURNING rol_id`,
      [empresaId, rol.nombre, rol.descripcion, rol.exigeMfa],
    );
    rolesPorNombre.set(rol.nombre, String(creado.rol_id));
  }

  // El reparto COMPLETO, en cada siembra. Es idempotente, y correrlo siempre es
  // lo que hace que añadir permisos nuevos no dependa de que las migraciones se
  // ejecutaran en el orden afortunado.
  await aplicarReparto((sql, params) => q.query(sql, params), rolesPorNombre);

  const [admin] = await q.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,$2,$3,$4)
     -- El predicado es OBLIGATORIO desde que uq_usuarios_empresa_correo es un
     -- indice PARCIAL: un indice con WHERE solo sirve de arbitro de ON CONFLICT
     -- si la sentencia repite su condicion. Sin el, Postgres responde «there is
     -- no unique or exclusion constraint matching the ON CONFLICT
     -- specification» y la semilla entera falla.
     ON CONFLICT (empresa_id, correo) WHERE eliminado_en IS NULL
       DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING usuario_id`,
    [empresaId, 'Administrador inicial', correo, await hash(clave, COSTO_BCRYPT)],
  );
  await q.query(
    `INSERT INTO usuarios_roles (usuario_id, rol_id)
     SELECT $1, rol_id FROM roles WHERE empresa_id = $2 AND nombre = 'Administrador'
     ON CONFLICT DO NOTHING`,
    [admin.usuario_id, empresaId],
  );

  // eslint-disable-next-line no-console
  console.log(
    `Sembrado: empresa "${nombreEmpresa}" (id ${empresaId}), ${ROLES.length} roles, admin ${correo}.\n` +
    'Recuerda que el Administrador tiene exige_mfa=true (§7): configura TOTP con POST /api/auth/mfa/iniciar.',
  );
  await AppDataSource.destroy();
}

sembrar().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Falló el seed:', e);
  process.exit(1);
});
