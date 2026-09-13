'use client';

import { Suspense } from 'react';
import { Informes } from '@/operacion/informes/Informes';

/* `useSearchParams` obliga a un límite de Suspense, igual que en el tablero: en
   el build estático Next necesita saber qué parte depende de la URL. */
export default function Pagina() {
  return (
    <Suspense fallback={null}>
      <Informes />
    </Suspense>
  );
}
