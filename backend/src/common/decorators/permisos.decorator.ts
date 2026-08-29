import { SetMetadata } from '@nestjs/common';

export const PERMISOS = 'permisos';
/**
 * Permisos requeridos por el endpoint. §7 es explícito: se comprueba el permiso,
 * nunca el rol. Ej: @RequierePermisos('viajes:despachar')
 */
export const RequierePermisos = (...permisos: string[]) => SetMetadata(PERMISOS, permisos);
