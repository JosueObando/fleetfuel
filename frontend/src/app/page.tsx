import { redirect } from 'next/navigation';

// El shell de UX-1 ya es la vista por defecto. El kit sigue en /kit.
export default function Inicio() {
  redirect('/tablero');
}
