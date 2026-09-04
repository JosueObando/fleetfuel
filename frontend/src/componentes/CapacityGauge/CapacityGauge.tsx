import estilos from './CapacityGauge.module.css';

interface Props {
  /** Porcentaje de llenado. Puede superar 100: eso es sobrepeso. */
  porcentaje: number;
  titulo?: string;
}

/**
 * Ficha 18 · Capacidad de la cisterna.
 *
 * Umbrales del spec: <40 % neutro con texto oscuro · 40-89 % acción ·
 * ≥90 % aviso con label «Casi lleno». Sobrepeso (>100 %) recorta el relleno.
 *
 * El valor SIEMPRE se anuncia como texto además de como color: un medidor
 * que solo informa por color es ilegible para quien no distingue el ámbar
 * del azul, y aquí la diferencia es «sigue cargando» contra «para».
 */
export function CapacityGauge({ porcentaje, titulo = 'Capacidad' }: Props) {
  const sobrepeso = porcentaje > 100;
  const recortado = Math.max(0, Math.min(100, porcentaje));
  const nivel = porcentaje < 40 ? 'bajo' : porcentaje < 90 ? 'normal' : 'alto';

  return (
    <div className={estilos.bloque}>
      <div className={estilos.titulo}>{titulo}</div>
      <div
        className={estilos.pista}
        role="meter"
        aria-valuenow={Math.round(porcentaje)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${Math.round(porcentaje)} por ciento${sobrepeso ? ', sobrepeso' : ''}`}
        aria-label={titulo}
      >
        <div className={`${estilos.relleno} ${estilos[nivel]}`} style={{ width: `${recortado}%` }} />
        <div className={estilos.porcentaje}>{Math.round(porcentaje)}%</div>
      </div>
      {sobrepeso ? (
        <div className={`${estilos.aviso} ${estilos.sobrepeso}`}>Sobrepeso · revisa la carga</div>
      ) : nivel === 'alto' ? (
        <div className={estilos.aviso}>Casi lleno</div>
      ) : null}
    </div>
  );
}
