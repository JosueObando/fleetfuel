/**
 * Qué permisos tiene cada rol, en UN solo sitio.
 *
 * EL FALLO QUE ESTO REPARA
 *
 * El reparto estaba escrito en tres ficheros: la semilla (permisos base) y las
 * migraciones 1788 y 1789 (catálogos, órdenes y viajes). Las migraciones lo
 * aplican con `INSERT … SELECT … WHERE r.nombre = $1`, o sea buscando el rol
 * POR NOMBRE — y en una base nueva las migraciones corren ANTES que la semilla,
 * así que ese rol todavía no existe. El SELECT no encuentra nada, el INSERT no
 * inserta nada, y **no falla**: no hay error, no hay aviso, no hay nada.
 *
 * Resultado, medido el 2026-09-06: en desarrollo el Administrador tenía los 48
 * permisos —porque allí la semilla corrió primero y las migraciones llegaron
 * después a repartir sobre roles ya existentes—, y en producción y en prueba
 * tenía 11. Producción llevaba días levantada, sirviendo por HTTPS, con
 * respaldos y alertas, y su administrador no podía leer un cliente. Todas las
 * comprobaciones habían pasado por `/api/salud` y `/auth/login`, que no tocan
 * permisos.
 *
 * Lo encontró el entorno de prueba —creado dos horas antes— al ser el primer
 * sitio donde se probó un endpoint de catálogo sobre una base nacida en el
 * orden correcto.
 *
 * POR QUÉ AQUÍ Y NO ARREGLANDO LAS MIGRACIONES
 *
 * Una migración ya aplicada es historia: reescribirla no cambia las bases donde
 * ya corrió. La semilla, en cambio, es idempotente por diseño y es el paso que
 * deja un entorno USABLE. Que el reparto completo viva aquí y se aplique
 * entero en cada `seed` arregla las bases nuevas y también las existentes, sin
 * tocar el historial.
 */

const TODOS = (modulo: string, acciones: string[]) => acciones.map(a => `${modulo}:${a}`);
const CRUD = ['leer', 'crear', 'actualizar', 'desactivar'];
const CATALOGOS = ['clientes', 'estaciones', 'productos', 'vehiculos', 'cisternas', 'conductores'];

/** Leer los seis catálogos, sin tocar nada. */
const LEER_CATALOGOS = CATALOGOS.map(m => `${m}:leer`);
/** Leer el flujo de la Fase 1B. */
const LEER_OPERACION = ['ordenes:leer', 'viajes:leer', 'plancarga:leer'];

export const REPARTO: Record<string, string[]> = {
  // Administración de la propia empresa, más TODO lo operativo. No es un rol
  // de paso libre: no evade la comprobación de permisos, los tiene declarados
  // uno a uno y se le pueden quitar.
  'Administrador': [
    'usuarios:leer', 'usuarios:crear', 'usuarios:actualizar', 'usuarios:suspender',
    'roles:leer', 'roles:administrar', 'dispositivos:leer', 'dispositivos:revocar',
    'auditoria:leer', 'empresas:leer', 'empresas:administrar',
    ...CATALOGOS.flatMap(m => TODOS(m, CRUD)),
    ...TODOS('ordenes', ['leer', 'crear', 'actualizar', 'cancelar']),
    ...TODOS('viajes', ['leer', 'crear', 'actualizar', 'cancelar', 'autorizar']),
    ...TODOS('plancarga', ['leer', 'crear', 'actualizar', 'cancelar']),
  ],

  'Supervisor de operaciones': [
    'usuarios:leer', 'dispositivos:leer', 'empresas:leer',
    ...LEER_CATALOGOS, ...LEER_OPERACION,
    'vehiculos:actualizar', 'cisternas:actualizar', 'conductores:actualizar',
    'ordenes:actualizar', 'viajes:actualizar', 'viajes:cancelar', 'viajes:autorizar',
  ],

  'Planificador de flota': [
    'empresas:leer', ...LEER_CATALOGOS, ...LEER_OPERACION,
    ...TODOS('vehiculos', CRUD), ...TODOS('cisternas', CRUD),
    ...TODOS('plancarga', ['leer', 'crear', 'actualizar', 'cancelar']),
    'viajes:crear', 'viajes:actualizar',
  ],

  // §7: quien arma el viaje NO lo autoriza, y quien lo autoriza no lo arma.
  // Es un control antifraude, y por eso `viajes:autorizar` no está aquí.
  'Despachador': [
    'empresas:leer', ...LEER_CATALOGOS, ...LEER_OPERACION, 'viajes:actualizar',
  ],

  'Operador de órdenes': [
    'empresas:leer', ...LEER_CATALOGOS, ...LEER_OPERACION,
    'clientes:crear', 'clientes:actualizar', 'estaciones:crear', 'estaciones:actualizar',
    ...TODOS('ordenes', ['leer', 'crear', 'actualizar', 'cancelar']),
  ],

  'Operador de carga': [
    'cisternas:leer', 'productos:leer', 'conductores:leer',
    ...LEER_OPERACION, 'plancarga:actualizar',
  ],

  'Mantenimiento': [
    'vehiculos:leer', 'vehiculos:actualizar', 'cisternas:leer', 'cisternas:actualizar',
  ],

  // Lee todo y no modifica nada: si pudiera escribir dejaría de ser
  // independiente de lo que audita.
  'Auditor': [
    'usuarios:leer', 'roles:leer', 'dispositivos:leer', 'auditoria:leer', 'empresas:leer',
    ...LEER_CATALOGOS, ...LEER_OPERACION,
  ],

  'Responsable de estación': ['estaciones:leer', 'productos:leer', 'ordenes:leer'],

  // Ve conductores por las tarifas que alimentan las liquidaciones.
  'Finanzas': [
    'usuarios:leer', 'auditoria:leer', 'empresas:leer',
    'clientes:leer', 'conductores:leer', ...LEER_OPERACION,
  ],

  'Conductor': ['viajes:leer'],
  'Cliente externo': ['ordenes:leer'],
};

/**
 * Aplica el reparto a los roles de una empresa. Idempotente: se puede correr
 * mil veces, y hay que correrlo cada vez que se añaden permisos nuevos.
 *
 * A diferencia de las migraciones, esto NO busca el rol por nombre y se calla
 * si no lo encuentra: recibe los ids de los roles que la semilla acaba de
 * crear, así que si un rol falta se nota.
 */
export async function aplicarReparto(
  ejecutar: (sql: string, params: unknown[]) => Promise<unknown>,
  rolesPorNombre: Map<string, string>,
): Promise<void> {
  for (const [nombre, codigos] of Object.entries(REPARTO)) {
    const rolId = rolesPorNombre.get(nombre);
    if (!rolId) throw new Error(`El reparto nombra un rol que no existe: "${nombre}"`);
    for (const codigo of codigos) {
      await ejecutar(
        `INSERT INTO roles_permisos (rol_id, permiso_id)
         SELECT $1, permiso_id FROM permisos WHERE codigo = $2
         ON CONFLICT DO NOTHING`, [rolId, codigo]);
    }
  }
}
