import 'reflect-metadata';
import { hash } from 'bcryptjs';
import AppDataSource from '../data-source';

/**
 * Siembra la empresa operadora, los 12 roles del §5 del PRD y el administrador
 * inicial. Corre como DUEÑO del esquema — la RLS no deja crear la primera
 * empresa desde dentro de un contexto de empresa que aún no existe.
 *
 * Es idempotente: se puede volver a correr sobre una base ya sembrada.
 */

/** Los 12 roles del §5, con los permisos de Fase 0 que le tocan a cada uno.
 *  Los permisos de negocio (viajes, cargas, liquidaciones) se añaden en Fase 1;
 *  aquí sólo existe el vocabulario que la Fase 0 implementa. */
const ROLES: Array<{ nombre: string; descripcion: string; exigeMfa: boolean; permisos: string[] }> = [
  { nombre: 'Administrador', exigeMfa: true,
    descripcion: 'Configuración general, usuarios, permisos, catálogos y auditoría',
    permisos: ['usuarios:leer','usuarios:crear','usuarios:actualizar','usuarios:suspender',
               'roles:leer','roles:administrar','dispositivos:leer','dispositivos:revocar',
               'auditoria:leer','empresas:leer','empresas:administrar'] },
  { nombre: 'Finanzas', exigeMfa: true,
    descripcion: 'Revisa costos, rentabilidad y pagos a conductores',
    permisos: ['usuarios:leer','auditoria:leer','empresas:leer'] },
  { nombre: 'Auditor', exigeMfa: true,
    descripcion: 'Consulta historial, documentos y trazabilidad sin modificar datos',
    permisos: ['usuarios:leer','roles:leer','dispositivos:leer','auditoria:leer','empresas:leer'] },
  { nombre: 'Operador de órdenes', exigeMfa: false,
    descripcion: 'Registra o importa órdenes de Terpelo', permisos: ['empresas:leer'] },
  { nombre: 'Planificador de flota', exigeMfa: false,
    descripcion: 'Asigna cisterna, compartimentos, conductor y horario', permisos: ['empresas:leer'] },
  { nombre: 'Despachador', exigeMfa: false,
    descripcion: 'Autoriza salida y verifica documentos', permisos: ['empresas:leer'] },
  { nombre: 'Conductor', exigeMfa: false,
    descripcion: 'Consulta viajes, registra eventos, gastos y evidencias', permisos: [] },
  // §7: la separación entre quien captura la carga y quien captura la entrega
  // es un control antifraude, no un detalle organizativo. Por eso son dos roles
  // distintos y ninguno hereda del otro — y por eso no existe un rol con paso
  // libre que pudiera reunir ambos sin dejar rastro.
  { nombre: 'Operador de carga', exigeMfa: false,
    descripcion: 'Confirma volúmenes cargados y sellos', permisos: [] },
  { nombre: 'Responsable de estación', exigeMfa: false,
    descripcion: 'Valida recepción y firma entrega', permisos: [] },
  { nombre: 'Supervisor de operaciones', exigeMfa: false,
    descripcion: 'Monitorea rutas, retrasos, alertas y diferencias',
    permisos: ['usuarios:leer','dispositivos:leer','empresas:leer'] },
  { nombre: 'Mantenimiento', exigeMfa: false,
    descripcion: 'Gestiona servicios preventivos y reparaciones', permisos: ['empresas:leer'] },
  { nombre: 'Cliente externo', exigeMfa: false,
    descripcion: 'Consulta órdenes y entregas autorizadas', permisos: [] },
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

  for (const rol of ROLES) {
    const [creado] = await q.query(
      `INSERT INTO roles (empresa_id, nombre, descripcion, exige_mfa) VALUES ($1,$2,$3,$4)
       ON CONFLICT (empresa_id, nombre) DO UPDATE SET descripcion = EXCLUDED.descripcion
       RETURNING rol_id`,
      [empresaId, rol.nombre, rol.descripcion, rol.exigeMfa],
    );
    for (const codigo of rol.permisos) {
      await q.query(
        `INSERT INTO roles_permisos (rol_id, permiso_id)
         SELECT $1, permiso_id FROM permisos WHERE codigo = $2
         ON CONFLICT DO NOTHING`,
        [creado.rol_id, codigo],
      );
    }
  }

  const [admin] = await q.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (empresa_id, correo) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING usuario_id`,
    [empresaId, 'Administrador inicial', correo, await hash(clave, 12)],
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
