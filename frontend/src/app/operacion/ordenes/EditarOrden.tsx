'use client';

import { useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { api, ErrorApi } from '@/api/cliente';
import { aCampo, cambios, instante } from '@/api/cambios';
import type { Fila } from '@/api/tipos';
import catalogo from '@/catalogos/Catalogo.module.css';

const PRIORIDADES = ['baja', 'normal', 'alta', 'urgente'].map(p => ({ valor: p, etiqueta: p }));

/**
 * La programación de una orden: cuándo y con qué prioridad se entrega.
 *
 * Cliente, estación y productos NO se editan: son lo que la orden ES, y la API
 * tampoco los acepta en el PATCH. Una orden con otro destino es otra orden.
 */
export function EditarOrden({ orden, onGuardada, onCancelar }: {
  orden: Fila; onGuardada: () => void; onCancelar: () => void;
}) {
  const [inicial] = useState(() => ({
    prioridad: aCampo(orden.prioridad),
    fechaRequerida: aCampo(orden.fechaRequerida, 'fecha'),
    ventanaInicio: aCampo(orden.ventanaInicio, 'fechaHora'),
    ventanaFin: aCampo(orden.ventanaFin, 'fechaHora'),
    observaciones: aCampo(orden.observaciones),
  }));
  const [valores, setValores] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const tocar = (campo: keyof typeof inicial) => (v: string) => setValores(vs => ({ ...vs, [campo]: v }));

  /* Los dos textos de un datetime-local tienen el mismo formato fijo, así que
     se comparan como cadenas. `<=` y no `<`: la base exige que el fin sea
     POSTERIOR al inicio, y una ventana de cero minutos no deja entregar.
     Sólo hace falta mirar que haya fin: con el inicio vacío, cualquier fin es
     mayor que '' y la comparación ya da falso. */
  const ventanaInvertida = valores.ventanaFin !== '' && valores.ventanaFin <= valores.ventanaInicio;
  const cuerpo = cambios(inicial, valores, { ventanaInicio: instante, ventanaFin: instante });

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(null);
    try {
      await api.actualizar(`/ordenes/${orden.id}`, cuerpo);
      onGuardada();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo guardar');
    } finally { setGuardando(false); }
  }

  const nombre = orden.numeroOrdenExterna ?? `#${orden.id}`;
  return (
    <form className={catalogo.formulario} onSubmit={guardar} aria-label={`Editar la orden ${nombre}`}>
      <Campo etiqueta="Prioridad" requerido opciones={PRIORIDADES}
             valor={valores.prioridad} onCambio={tocar('prioridad')} />
      <Campo etiqueta="Fecha requerida" tipo="date"
             valor={valores.fechaRequerida} onCambio={tocar('fechaRequerida')} />
      <Campo etiqueta="Inicio de la ventana" tipo="datetime-local"
             valor={valores.ventanaInicio} onCambio={tocar('ventanaInicio')} />
      <Campo etiqueta="Fin de la ventana" tipo="datetime-local"
             valor={valores.ventanaFin} onCambio={tocar('ventanaFin')}
             error={ventanaInvertida ? 'La ventana termina antes de empezar.' : undefined} />
      <Campo etiqueta="Observaciones" valor={valores.observaciones} onCambio={tocar('observaciones')} />

      {error && <p className={catalogo.aviso} role="alert">{error}</p>}
      <div className={catalogo.pieFormulario}>
        <Button variante="secundario" onClick={onCancelar}>Cancelar</Button>
        <Button tipo="submit" cargando={guardando}
                deshabilitado={ventanaInvertida || Object.keys(cuerpo).length === 0}>
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}
