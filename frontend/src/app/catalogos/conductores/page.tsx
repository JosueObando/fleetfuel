'use client';

import { Catalogo } from '@/catalogos/Catalogo';
import { AvisoLicencias } from '@/catalogos/AvisoLicencias';
import { CATALOGOS } from '@/catalogos/definiciones';

/*
 * La única página de catálogo que no es un envoltorio pelado, y por una razón
 * del §6.6: lo que se hace al ver que una licencia vence es abrir ese conductor
 * y cambiarle la fecha, y esa tabla está justo debajo.
 */
export default function Pagina() {
  return (
    <>
      <AvisoLicencias />
      <Catalogo def={CATALOGOS.conductores} />
    </>
  );
}
