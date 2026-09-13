'use client';

import { useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { api } from '@/api/cliente';
import estilos from './despacho.module.css';
import type { Fila, Accion } from './tipos';
import { TablaDesplazable } from '@/componentes/TablaDesplazable/TablaDesplazable';

/**
 * §7.15 · La bitácora del viaje.
 *
 * Las cinco rutas de `eventos_viaje` existían desde la Fase 2A y ninguna
 * pantalla las llamaba. Lo que esta sección añade sobre la API es lo que la API
 * no puede añadir sola:
 *
 * **Que la integridad se pueda VER.** La cadena de hashes existe para
 * demostrarle a alguien que la traza no se tocó, y el backend expuso
 * `/integridad` como ruta propia porque «un hash que nadie puede comprobar
 * desde fuera no prueba nada a nadie». Sin pantalla seguía sin comprobarlo
 * nadie.
 *
 * **Que anular no parezca borrar.** Aquí anular es AÑADIR una corrección: el
 * evento original se queda. Una pantalla que lo hiciera desaparecer contaría lo
 * contrario de lo que cuenta la base.
 */

/* Los seis del §7.15. `correccion` NO está, y es deliberado: la crea el
   servidor al anular. Ofrecerla dejaría escribir a mano una corrección que no
   corrige nada. */
const TIPOS = ['salida', 'llegada', 'carga', 'parada', 'entrega', 'incidente'];

const MOTIVO_MINIMO = 5;

const hora = (iso: unknown) => String(iso ?? '').slice(11, 16);

export function SeccionBitacora({ viaje, eventos, integridad, accion }: {
  viaje: Fila; eventos: Fila[]; integridad: Fila | null; accion: Accion;
}) {
  const [anulando, setAnulando] = useState<Fila | null>(null);
  const [motivo, setMotivo] = useState('');
  const [alta, setAlta] = useState(false);
  const [tipo, setTipo] = useState('incidente');
  const [observacion, setObservacion] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  /* Qué evento anula a cuál, en un solo recorrido. La alternativa —buscar
     dentro del `map` de la tabla— es cuadrática, y aquí la lista crece con cada
     parada de cada viaje. */
  const anuladoPor = new Map<string, Fila>();
  for (const e of eventos) {
    if (e.anulaEventoId) anuladoPor.set(String(e.anulaEventoId), e);
  }

  function confirmarAnulacion() {
    if (!anulando) return;
    if (motivo.trim().length < MOTIVO_MINIMO) {
      setAviso(`Explica por qué se anula: al menos ${MOTIVO_MINIMO} caracteres. Queda en la traza.`);
      return;
    }
    const id = String(anulando.id);
    const texto = motivo.trim();
    setAnulando(null); setMotivo(''); setAviso(null);
    void accion(() => api.crear(`/eventos/${id}/anular`, { motivo: texto }));
  }

  function registrar() {
    setAlta(false);
    const datos = { tipoEvento: tipo, origenDato: 'web', ...(observacion ? { observacion } : {}) };
    setObservacion('');
    void accion(() => api.crear(`/eventos/viaje/${viaje.id}`, datos));
  }

  return (
    <div className={estilos.seccion}>
      <h3 className={estilos.tituloSeccion}>Bitácora del viaje</h3>

      {/* El indicador está SIEMPRE, no sólo cuando algo va mal: uno que sólo
          aparece ante un problema es indistinguible de uno averiado. */}
      <p role="status" aria-label="Integridad de la traza"
         className={`${estilos.conciliacion} ${integridad?.integra === false ? estilos.fuera : ''}`}>
        {integridad === null
          ? 'La integridad de la traza no se pudo comprobar.'
          : integridad.integra
            ? `Cadena íntegra · ${String(integridad.eventos)} eslabón(es) verificado(s).`
            : `Cadena ROTA a partir del evento ${String(integridad.rotoEn)}. `
              + 'Lo anterior a él sigue siendo válido.'}
      </p>

      {eventos.length === 0 ? (
        <p className={estilos.vacio}>Sin eventos registrados.</p>
      ) : (
        <TablaDesplazable etiqueta="Bitácora del viaje">
        <table className={estilos.tablaMini}>
          <thead>
            <tr>
              <th>Hora</th><th>Tipo</th><th>Origen</th><th>Odómetro</th>
              <th>Observación</th><th>Estado</th><th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {eventos.map(e => {
              const anulado = anuladoPor.get(String(e.id));
              const esCorreccion = e.tipoEvento === 'correccion';
              return (
                <tr key={String(e.id)}>
                  <td>{hora(e.fechaHora)}</td>
                  <td>{esCorreccion ? 'corrección' : String(e.tipoEvento)}</td>
                  <td>{String(e.origenDato)}</td>
                  <td className={estilos.num}>{e.odometro ? String(e.odometro) : '—'}</td>
                  <td>{e.observacion ? String(e.observacion) : '—'}</td>
                  {/* Marcado, no escondido: el §7.15 conserva el original. */}
                  <td>{anulado ? 'anulado' : esCorreccion ? 'corrige' : 'vigente'}</td>
                  <td>
                    {/* Ni anulado ni corrección: el backend responde 409 a los
                        dos, y ofrecer un botón es ofrecer un error. */}
                    {!anulado && !esCorreccion && (
                      <Button variante="secundario"
                              onClick={() => { setAnulando(e); setMotivo(''); setAviso(null); }}>
                        Anular
                        <span className="solo-lectores"> el evento de {hora(e.fechaHora)}</span>
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </TablaDesplazable>
      )}

      {anulando && (
        <div className={estilos.formLinea}>
          <Campo etiqueta="Motivo" valor={motivo} onCambio={setMotivo}
                 ayuda="Anular añade una corrección a la traza; el evento original se queda." />
          {aviso && <p className={estilos.avisoTraza}>{aviso}</p>}
          <div className={estilos.acciones}>
            <Button variante="secundario" onClick={() => { setAnulando(null); setAviso(null); }}>
              Cancelar
            </Button>
            <Button onClick={confirmarAnulacion}>Confirmar anulación</Button>
          </div>
        </div>
      )}

      {alta ? (
        <div className={estilos.formLinea}>
          <Campo etiqueta="Tipo" valor={tipo} onCambio={setTipo}
                 opciones={TIPOS.map(t => ({ valor: t, etiqueta: t }))} />
          <Campo etiqueta="Observación" valor={observacion} onCambio={setObservacion} />
          {/* El origen no se elige: lo tecleado aquí es `web` por definición, y
              un desplegable con «gps» dejaría fabricar a mano una traza que
              aparenta venir de un aparato. */}
          <div className={estilos.acciones}>
            <Button variante="secundario" onClick={() => setAlta(false)}>Cancelar</Button>
            <Button onClick={registrar}>Registrar</Button>
          </div>
        </div>
      ) : (
        <Button variante="secundario" onClick={() => setAlta(true)}>Registrar evento</Button>
      )}
    </div>
  );
}
