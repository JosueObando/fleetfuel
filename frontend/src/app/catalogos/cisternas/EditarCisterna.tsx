'use client';

import { useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { api, ErrorApi } from '@/api/cliente';
import { aCampo, cambios } from '@/api/cambios';
import type { Fila } from '@/api/tipos';
import catalogo from '@/catalogos/Catalogo.module.css';

/* «cargada» y «en viaje» los describe la operación, no el catálogo: ofrecerlos
   aquí permitiría declarar en ruta un tanque que está en el patio. Una
   cisterna que ya está en uno de esos estados lo enseña, sin dejar cambiarlo. */
const ESTADOS_ELEGIBLES = ['disponible', 'mantenimiento'];
const LIMPIEZA = ['limpia', 'pendiente', 'bloqueada'];

const opcionesDe = (valores: string[]) => valores.map(v => ({ valor: v, etiqueta: v.replace('_', ' ') }));

/**
 * Edición de una cisterna ya registrada.
 *
 * Los compartimentos NO se editan aquí: el plan de carga de los viajes apunta a
 * ellos por id, y cambiarlos debajo de un plan vivo es otro problema. Lo que sí
 * se mira es su suma, porque la capacidad total no puede quedar por debajo.
 */
export function EditarCisterna({ cisterna, productos, onGuardada, onCancelar }: {
  cisterna: Fila; productos: Fila[]; onGuardada: () => void; onCancelar: () => void;
}) {
  const [inicial] = useState(() => ({
    capacidadTotal: aCampo(cisterna.capacidadTotal),
    certificadoCalibracion: aCampo(cisterna.certificadoCalibracion),
    fechaCalibracion: aCampo(cisterna.fechaCalibracion, 'fecha'),
    fechaProximaCalibracion: aCampo(cisterna.fechaProximaCalibracion, 'fecha'),
    material: aCampo(cisterna.material),
    estadoLimpieza: aCampo(cisterna.estadoLimpieza),
    productoAnterior: aCampo(cisterna.productoAnterior),
    estado: aCampo(cisterna.estado),
  }));
  const [valores, setValores] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const tocar = (campo: keyof typeof inicial) => (v: string) => setValores(vs => ({ ...vs, [campo]: v }));

  const suma = (cisterna.compartimentos ?? [])
    .reduce((t: number, c: Fila) => t + Number(c.capacidadNominal), 0);
  const menorQueLaSuma = valores.capacidadTotal !== '' && Number(valores.capacidadTotal) < suma;
  const cuerpo = cambios(inicial, valores, { capacidadTotal: Number });
  const estadoFijo = !ESTADOS_ELEGIBLES.includes(inicial.estado);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(null);
    try {
      await api.actualizar(`/cisternas/${cisterna.id}`, cuerpo);
      onGuardada();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo guardar');
    } finally { setGuardando(false); }
  }

  return (
    <form className={catalogo.formulario} onSubmit={guardar}
          aria-label={`Editar la cisterna ${cisterna.placa}`}>
      <Campo etiqueta="Capacidad total" tipo="number" requerido
             valor={valores.capacidadTotal} onCambio={tocar('capacidadTotal')}
             error={menorQueLaSuma
               ? `Los compartimentos suman ${suma.toLocaleString('es-PA')}: la capacidad no puede ser menor.`
               : undefined} />
      <Campo etiqueta="Certificado de calibración"
             valor={valores.certificadoCalibracion} onCambio={tocar('certificadoCalibracion')} />
      <Campo etiqueta="Fecha de calibración" tipo="date"
             valor={valores.fechaCalibracion} onCambio={tocar('fechaCalibracion')} />
      <Campo etiqueta="Próxima calibración" tipo="date"
             valor={valores.fechaProximaCalibracion} onCambio={tocar('fechaProximaCalibracion')} />
      <Campo etiqueta="Material" valor={valores.material} onCambio={tocar('material')} />
      <Campo etiqueta="Estado de limpieza" requerido opciones={opcionesDe(LIMPIEZA)}
             valor={valores.estadoLimpieza} onCambio={tocar('estadoLimpieza')} />
      <Campo etiqueta="Producto anterior" valor={valores.productoAnterior} onCambio={tocar('productoAnterior')}
             opciones={productos.map(p => ({ valor: String(p.id), etiqueta: String(p.nombre) }))} />
      <Campo etiqueta="Estado" requerido deshabilitado={estadoFijo}
             ayuda={estadoFijo ? 'Lo marca la operación: no se cambia desde el catálogo.' : undefined}
             opciones={opcionesDe(estadoFijo ? [inicial.estado] : ESTADOS_ELEGIBLES)}
             valor={valores.estado} onCambio={tocar('estado')} />

      {error && <p className={catalogo.aviso} role="alert">{error}</p>}
      <div className={catalogo.pieFormulario}>
        <Button variante="secundario" onClick={onCancelar}>Cancelar</Button>
        <Button tipo="submit" cargando={guardando}
                deshabilitado={menorQueLaSuma || Object.keys(cuerpo).length === 0}>
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}
