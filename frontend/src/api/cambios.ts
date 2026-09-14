/**
 * Lo que un formulario de EDICIÓN manda: sólo los campos que cambiaron.
 *
 * Los formularios guardan texto; la API espera números, fechas ISO y null.
 * Por eso se compara el texto inicial con el actual —comparar contra el valor
 * de la API daría «cambiado» a un `9000.00` frente a un `9000`— y sólo después
 * se convierte lo que de verdad se tocó. Ver `cambios.spec.ts` para por qué
 * reenviar el formulario entero no es inocuo.
 */

export type Conversiones = Partial<Record<string, (texto: string) => unknown>>;

export function cambios(
  inicial: Record<string, string>,
  actual: Record<string, string>,
  convertir: Conversiones = {},
): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [campo, texto] of Object.entries(actual)) {
    if (texto === inicial[campo]) continue;
    /* Vacío ANTES que conversión: `Number('')` es 0, y un campo vaciado
       tiene que quitar el dato, no ponerlo a cero. */
    salida[campo] = texto === '' ? null : (convertir[campo] ?? (t => t))(texto);
  }
  return salida;
}

const dos = (n: number) => String(n).padStart(2, '0');

/** Un valor de la API, escrito como lo espera el campo de formulario. */
export function aCampo(valor: unknown, tipo?: 'fecha' | 'fechaHora'): string {
  if (valor === null || valor === undefined) return '';
  if (tipo === 'fecha') return String(valor).slice(0, 10);
  if (tipo === 'fechaHora') {
    /* En HORA LOCAL: un datetime-local no lleva zona, y recortar el ISO
       enseñaría la hora de Greenwich a quien programa una entrega en Panamá. */
    const d = new Date(String(valor));
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
  }
  return String(valor);
}

/** El texto de un datetime-local —hora local— como instante ISO para la API. */
export const instante = (texto: string) => new Date(texto).toISOString();
