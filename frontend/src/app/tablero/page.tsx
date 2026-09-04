import { Suspense } from 'react';
import { Tablero } from './Tablero';

/* useSearchParams obliga a un límite de Suspense: en el build estático Next
   necesita saber qué parte depende de la URL para no prerenderizar de más. */
export default function Pagina() {
  return (
    <Suspense fallback={null}>
      <Tablero />
    </Suspense>
  );
}
