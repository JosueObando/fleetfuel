'use client';

import { Suspense } from 'react';
import { Despacho } from '@/operacion/despacho/Despacho';

/* `useSearchParams` obliga a un límite de Suspense, igual que en informes: en
   el build estático Next necesita saber qué parte depende de la URL. */
export default function Pagina() {
  return (
    <Suspense fallback={null}>
      <Despacho />
    </Suspense>
  );
}
