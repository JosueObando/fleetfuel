import { redirect } from 'next/navigation';

/*
 * La primera pantalla es la aplicación, no el escaparate.
 *
 * Antes esto redirigía a `/tablero`, el boceto de UX-2 con datos inventados y
 * sin puerta de sesión. `/operacion/ordenes` es el mismo destino al que manda
 * el login, y vive dentro de `ShellApp`: quien no ha entrado acaba en `/entrar`
 * por el camino que ya existe, sin una segunda puerta que mantener al día.
 */
export default function Inicio() {
  redirect('/operacion/ordenes');
}
