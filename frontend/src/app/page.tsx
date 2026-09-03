import { redirect } from 'next/navigation';

// Todavía no hay aplicación: UX-0 construye el sistema de diseño, no pantallas
// con datos. Hasta que exista el shell (UX-1), la raíz lleva al kit.
export default function Inicio() {
  redirect('/kit');
}
