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

  /* Envoltorio <div> y <label htmlFor>, NO un <label> que envuelva todo.
     Envolviendo, el texto de ayuda y el de error quedan DENTRO de la etiqueta
     y pasan a formar parte del nombre accesible del campo: un select de
     «Estación» con la ayuda «Elige primero el cliente» acaba llamándose
     «Estación … cliente», y un lector de pantalla lee la explicación entera
     cada vez que el foco entra. La ayuda es una DESCRIPCIÓN —eso es lo que
     hace aria-describedby— y va fuera. */
  return (
    <div className={estilos.campo}>
      <label className={estilos.etiqueta} htmlFor={id}>
        {etiqueta}
        {requerido && <span className={estilos.requerido} aria-hidden>*</span>}
      </label>

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
    </div>
  );
}
