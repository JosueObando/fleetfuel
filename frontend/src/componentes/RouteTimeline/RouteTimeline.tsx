import estilos from './RouteTimeline.module.css';

export interface Parada {
  etiqueta: string;
  fase: 'pasada' | 'actual' | 'futura';
}

/* Máx. 4 filas por ficha. Si hay más paradas, se recortan: la tarjeta tiene
   alto fijo y una quinta fila la desbordaría. */
const MAX_FILAS = 4;

export function RouteTimeline({ paradas }: { paradas: Parada[] }) {
  const visibles = paradas.slice(0, MAX_FILAS);

  return (
    <ol className={estilos.linea}>
      {visibles.map((p, i) => (
        <li key={`${p.etiqueta}-${i}`} className={`${estilos.fila} ${estilos[p.fase]}`}>
          <span className={estilos.nodo} aria-hidden />
          <span className={estilos.etiqueta} title={p.etiqueta}>
            {p.etiqueta}
          </span>
          {/* La fase es color y peso: invisible para un lector de pantalla.
              Se nombra en texto oculto para que la parada actual se distinga. */}
          {p.fase === 'actual' && <span className="solo-lectores"> (parada actual)</span>}
        </li>
      ))}
    </ol>
  );
}
