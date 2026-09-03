import estilos from './MetricStack.module.css';

interface Props {
  /** Segundos restantes. Se formatea a hh:mm:ss. */
  segundosRestantes: number;
  /** Kilómetros restantes. */
  km: number;
}

const dosDigitos = (n: number) => String(n).padStart(2, '0');

export function MetricStack({ segundosRestantes, km }: Props) {
  const s = Math.max(0, Math.floor(segundosRestantes));
  const hhmmss = `${dosDigitos(Math.floor(s / 3600))}:${dosDigitos(Math.floor(s / 60) % 60)}:${dosDigitos(s % 60)}`;

  return (
    <div className={estilos.pila}>
      {/* El tiempo cambia solo; sin este role el lector de pantalla lo leería
          como texto estático de la primera vez. */}
      <div className={estilos.tiempo} role="timer" aria-label={`Tiempo estimado ${hhmmss}`}>
        {hhmmss}
      </div>
      <div className={estilos.distancia}>{km.toFixed(1)} km</div>
    </div>
  );
}
