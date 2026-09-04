'use client';

import { useId } from 'react';
import estilos from './Campo.module.css';

interface Props {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  tipo?: 'text' | 'email' | 'password' | 'number' | 'date' | 'tel';
  requerido?: boolean;
  deshabilitado?: boolean;
  marcador?: string;
  ayuda?: string;
  error?: string;
  /** Lista fija de opciones: renderiza un select en vez de un input. */
  opciones?: Array<{ valor: string; etiqueta: string }>;
  autoComplete?: string;
}

export function Campo({
  etiqueta, valor, onCambio, tipo = 'text', requerido, deshabilitado,
  marcador, ayuda, error, opciones, autoComplete,
}: Props) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;

  /* aria-describedby apunta al error si lo hay, y si no a la ayuda. Un campo
     que describe ambos a la vez lee el texto de ayuda ANTES del error, y la
     persona oye la explicación general justo cuando necesita la corrección. */
  const describe = error ? idAyuda : ayuda ? idAyuda : undefined;

  return (
    <label className={estilos.campo} htmlFor={id}>
      <span className={estilos.etiqueta}>
        {etiqueta}
        {requerido && <span className={estilos.requerido} aria-hidden>*</span>}
      </span>

      {opciones ? (
        <select
          id={id} className={`${estilos.control} ${error ? estilos.conError : ''}`}
          value={valor} disabled={deshabilitado}
          onChange={e => onCambio(e.target.value)}
          required={requerido} aria-invalid={Boolean(error)} aria-describedby={describe}
        >
          <option value="">— selecciona —</option>
          {opciones.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
        </select>
      ) : (
        <input
          id={id} type={tipo} className={`${estilos.control} ${error ? estilos.conError : ''}`}
          value={valor} disabled={deshabilitado} placeholder={marcador}
          autoComplete={autoComplete}
          onChange={e => onCambio(e.target.value)}
          required={requerido} aria-invalid={Boolean(error)} aria-describedby={describe}
        />
      )}

      {/* role="alert" para que el error se anuncie al aparecer: si solo
          estuviera descrito, quien ya pasó el campo no se enteraría. */}
      {error ? <span id={idAyuda} className={estilos.error} role="alert">{error}</span>
             : ayuda ? <span id={idAyuda} className={estilos.ayuda}>{ayuda}</span> : null}
    </label>
  );
}
