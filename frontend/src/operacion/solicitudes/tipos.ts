/**
 * Los tres tipos de `solicitudes_ruta`, con lo que hace falta para nombrarlos en
 * una frase («aprobado EL desvío», «rechazada LA parada extra»).
 *
 * Sin respaldo para otros: `ck_solicitudes_tipo` sólo admite estos tres.
 */
export const TIPOS_SOLICITUD: Record<string, { nombre: string; articulo: string; genero: 'o' | 'a' }> = {
  desvio:       { nombre: 'Desvío',       articulo: 'el', genero: 'o' },
  parada_extra: { nombre: 'Parada extra', articulo: 'la', genero: 'a' },
  cancelacion:  { nombre: 'Cancelación',  articulo: 'la', genero: 'a' },
};

export const tipoDeSolicitud = (t: unknown) => TIPOS_SOLICITUD[String(t)];
