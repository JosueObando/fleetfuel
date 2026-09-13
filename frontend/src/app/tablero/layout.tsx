import { PuertaDeSesion } from '@/componentes/PuertaDeSesion/PuertaDeSesion';

/*
 * El tablero trae su propio shell de tres columnas —es la maqueta de UX-2— así
 * que no puede ir dentro de `ShellApp` sin quedarse con dos barras laterales.
 * Lo que sí necesita es la PUERTA, que hasta el 2026-09-12 no tenía: se servía
 * en producción a cualquiera, con datos inventados y sin pedir sesión.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <PuertaDeSesion>{children}</PuertaDeSesion>;
}
