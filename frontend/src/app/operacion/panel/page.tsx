'use client';

import { Suspense } from 'react';
import { PanelEjecutivo } from '@/operacion/panel/PanelEjecutivo';

/* `useSearchParams` obliga a un límite de Suspense: en el build estático Next
   necesita saber qué parte depende de la URL. */
export default function Pagina() {
  return (
    <Suspense fallback={null}>
      <PanelEjecutivo />
    </Suspense>
  );
}
