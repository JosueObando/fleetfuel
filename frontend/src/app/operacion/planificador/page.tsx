'use client';

import { Suspense } from 'react';
import { Planificador } from '@/operacion/planificador/Planificador';

/* `useSearchParams` obliga a un límite de Suspense: en el build estático Next
   necesita saber qué parte depende de la URL. */
export default function Pagina() {
  return (
    <Suspense fallback={null}>
      <Planificador />
    </Suspense>
  );
}
