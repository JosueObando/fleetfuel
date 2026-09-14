'use client';

import { useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { api, ErrorApi } from '@/api/cliente';
import { aCampo, cambios } from '@/api/cambios';
import type { Fila } from '@/api/tipos';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from './viajes.module.css';

/* Mismo convenio que el alta: el día elegido se manda como su medianoche UTC,
   y la lista lo pinta recortando el ISO. Cambiarlo sólo aquí haría que un viaje
   editado y uno recién creado guardaran la fecha de dos formas distintas. */
const aIso = (dia: string) => new Date(dia).toISOString();

/**
 * Edición de un viaje: su replanificación y, ya en marcha, los odómetros.
 *
 * Qué se puede tocar lo dice la API (`admiteReplanificacion`) y los datos del
 * propio viaje (su plan de carga), no una copia de la máquina de estados.
 */
export function EditarViaje({ viaje, cisternas, conductores, onGuardado, onCancelar }: {
  viaje: Fila; cisternas: Fila[]; conductores: Fila[];
  onGuardado: () => void; onCancelar: () => void;
}) {
  const [inicial] = useState(() => ({
    codigoViaje: aCampo(viaje.codigoViaje),
    fechaProgramada: aCampo(viaje.fechaProgramada, 'fecha'),
    fechaFin: aCampo(viaje.fechaFin, 'fecha'),
    cisternaId: aCampo(viaje.cisternaId),
    conductorId: aCampo(viaje.conductorId),
    rutaPlanificada: aCampo(viaje.rutaPlanificada),
    odometroInicial: aCampo(viaje.odometroInicial),
    odometroFinal: aCampo(viaje.odometroFinal),
  }));
  const [valores, setValores] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const tocar = (campo: keyof typeof inicial) => (v: string) => setValores(vs => ({ ...vs, [campo]: v }));

  const enMarcha = !viaje.admiteReplanificacion;
  const conPlan = (viaje.planCarga ?? []).length > 0;

  /* Días como 'AAAA-MM-DD': se comparan como texto, y el mismo día vale. Los
     odómetros NO: '99999' es menor que '120000' como cadena. Sin inicial,
     `Number('')` es 0 y ningún odómetro real queda por debajo. */
  const finAntes = valores.fechaFin !== '' && valores.fechaFin < valores.fechaProgramada;
  const odometroMenor = valores.odometroFinal !== ''
    && Number(valores.odometroFinal) < Number(valores.odometroInicial);

  const cuerpo = cambios(inicial, valores, {
    fechaProgramada: aIso, fechaFin: aIso, odometroInicial: Number, odometroFinal: Number,
  });

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(null);
    try {
      await api.actualizar(`/viajes/${viaje.id}`, cuerpo);
      onGuardado();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo guardar el viaje');
    } finally { setGuardando(false); }
  }

  return (
    <form className={catalogo.formulario} onSubmit={guardar} aria-label={`Editar el viaje ${viaje.codigoViaje}`}>
      {enMarcha && (
        <p className={estilos.vacio}>El viaje ya salió: la asignación y la fecha no se cambian.</p>
      )}
      <Campo etiqueta="Código del viaje" requerido valor={valores.codigoViaje} onCambio={tocar('codigoViaje')} />
      <Campo etiqueta="Programado para" tipo="date" requerido deshabilitado={enMarcha}
             valor={valores.fechaProgramada} onCambio={tocar('fechaProgramada')} />
      <Campo etiqueta="Fin previsto" tipo="date" valor={valores.fechaFin} onCambio={tocar('fechaFin')}
             error={finAntes ? 'El fin previsto no puede ser anterior a la programación.' : undefined} />
      <Campo etiqueta="Cisterna" deshabilitado={enMarcha || conPlan}
             ayuda={conPlan && !enMarcha ? 'Vacía el plan de carga para cambiar la cisterna.' : undefined}
             opciones={cisternas.map(c => ({ valor: String(c.id), etiqueta: String(c.placa) }))}
             valor={valores.cisternaId} onCambio={tocar('cisternaId')} />
      <Campo etiqueta="Conductor" deshabilitado={enMarcha}
             opciones={conductores.map(c => ({ valor: String(c.id), etiqueta: String(c.nombreCompleto) }))}
             valor={valores.conductorId} onCambio={tocar('conductorId')} />
      <Campo etiqueta="Ruta planificada" valor={valores.rutaPlanificada} onCambio={tocar('rutaPlanificada')} />
      <Campo etiqueta="Odómetro inicial" tipo="number"
             valor={valores.odometroInicial} onCambio={tocar('odometroInicial')} />
      <Campo etiqueta="Odómetro final" tipo="number"
             valor={valores.odometroFinal} onCambio={tocar('odometroFinal')}
             error={odometroMenor ? 'El odómetro final no puede ser menor que el inicial.' : undefined} />

      {error && <p className={catalogo.aviso} role="alert">{error}</p>}
      <div className={catalogo.pieFormulario}>
        <Button variante="secundario" onClick={onCancelar}>Cancelar</Button>
        <Button tipo="submit" cargando={guardando}
                deshabilitado={finAntes || odometroMenor || Object.keys(cuerpo).length === 0}>
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}
