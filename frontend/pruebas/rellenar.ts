import type { UserEvent } from '@testing-library/user-event';

/*
 * Rellenar un campo de un formulario: clic y PEGAR el texto entero.
 *
 * POR QUÉ EXISTE
 *
 * Teclear cuesta unos 16 ms por carácter entre user-event y el re-render de
 * React, y la suite teclea más de mil caracteres. Con la máquina compartida por
 * los tres entornos, eso la dejaba en 33 s frente a los 30 que pide el skill de
 * TDD (medido y perfilado el 2026-09-14: escribir era el 15 % de Despacho).
 *
 * Casi ninguna prueba estudia el TECLADO: rellenan un formulario y miran qué
 * cuerpo se envía o qué mensaje sale. Para eso, pegar y teclear llevan al mismo
 * `onChange` final — ningún componente escucha `onInput`, `onPaste` ni teclas
 * dentro de un campo, ni usa `maxLength` (comprobado con grep ese día).
 *
 * CUÁNDO NO USARLO
 *
 * · Cuando lo probado es cada tecla (`Campo.spec.tsx`: «avisa de cada tecla»).
 *   Ahí va `usuario.type`, y así se quedó.
 * · En campos de fecha: user-event los rellena distinto al teclear (no pegar un
 *   valor parcial), así que se niega en vez de dar un verde dudoso.
 * · Con teclas especiales (`{Enter}`): eso es teclado, no relleno.
 */
export async function rellenar(usuario: UserEvent, campo: HTMLElement, texto: string) {
  const tipo = (campo as HTMLInputElement).type;
  if (tipo === 'date' || tipo === 'datetime-local') {
    throw new Error(`rellenar() no sirve para un campo de tipo ${tipo}: usa usuario.type`);
  }
  if (/[{[]/.test(texto)) {
    throw new Error('rellenar() pega texto literal; las teclas especiales van con usuario.type');
  }
  await usuario.click(campo);
  await usuario.paste(texto);
}
