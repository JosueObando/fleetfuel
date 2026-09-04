'use client';

import { Button } from '@/componentes/Button/Button';
import estilos from './RequestList.module.css';

export interface Solicitud {
  id: string;
  solicitud: string;
  solicitante: string;
  hora: string;
  resolucion?: 'aprobada' | 'rechazada';
  enCurso?: boolean;
}

interface Props {
  solicitudes: Solicitud[];
  titulo?: string;
  onAprobar?: (id: string) => void;
  onRechazar?: (id: string) => void;
}

/**
 * Ficha 23 · Solicitudes de cambio de ruta.
 *
 * Nota de alcance: el plan marca `RouteRequest` como decisión abierta (§2C,
 * «ALCANCE NUEVO»). Este componente cubre la ficha del spec y funciona con
 * datos falsos; si la solicitud de cambio de ruta entra al alcance, el
 * modelo de datos de la Fase 2 cambia, pero esta presentación no.
 */
export function RequestList({
  solicitudes, titulo = 'Solicitudes de cambio de ruta', onAprobar, onRechazar,
}: Props) {
  return (
    <section className={estilos.bloque}>
      <h3 className={estilos.titulo}>{titulo}</h3>

      {solicitudes.length === 0 ? (
        <p className={estilos.vacio}>No hay solicitudes pendientes.</p>
      ) : (
        <ul className={estilos.lista}>
          {solicitudes.map(s => (
            <li key={s.id} className={estilos.fila}>
              <div className={estilos.textos}>
                <div className={estilos.solicitud}>{s.solicitud}</div>
                <div className={estilos.meta}>{s.solicitante} · {s.hora}</div>
              </div>

              {s.resolucion ? (
                <span className={`${estilos.resuelta} ${estilos[s.resolucion]}`}>
                  {s.resolucion === 'aprobada' ? 'Aprobada' : 'Rechazada'}
                </span>
              ) : (
                <div className={estilos.acciones}>
                  {/* El texto oculto completa el nombre accesible: con
                      varias filas, seis botones «Aprobar» idénticos son
                      indistinguibles para quien navega por lista de botones.
                      Visualmente la columna sigue diciendo solo el verbo. */}
                  <Button variante="secundario" cargando={s.enCurso}
                          onClick={() => onRechazar?.(s.id)}>
                    Rechazar
                    <span className="solo-lectores"> {s.solicitud}</span>
                  </Button>
                  <Button variante="primario" cargando={s.enCurso}
                          onClick={() => onAprobar?.(s.id)}>
                    Aprobar
                    <span className="solo-lectores"> {s.solicitud}</span>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
