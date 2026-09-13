'use client';

import { useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { api } from '@/api/cliente';
import estilos from './despacho.module.css';
import { miles } from './SeccionCargas';
import type { Fila, Accion } from './tipos';

/** Las cinco del §7.17. */
const CATEGORIAS = ['peaje', 'viatico', 'reparacion', 'estacionamiento', 'otro'];

/**
 * §7.17 · Gastos del viaje.
 *
 * Se registran mientras el viaje está en marcha y dejan de admitirse cuando se
 * cierra: si entraran después, la liquidación ya pagada dejaría de cuadrar con
 * lo que el viaje costó.
 */
export function SeccionGastos({ viaje, gastos, totales, accion }: {
  viaje: Fila; gastos: Fila[]; totales: Fila | null; accion: Accion;
}) {
  const abierto = !['cerrado', 'cancelado', 'borrador', 'programado'].includes(viaje.estado);

  return (
    <div className={estilos.seccion}>
      <h3 className={estilos.tituloSeccion}>Gastos del viaje</h3>

      {totales && (
        <p className={estilos.conciliacion}>
          Aprobado {miles(totales.totalAprobado)} · pendiente {miles(totales.totalPendiente)}
        </p>
      )}

      {gastos.length === 0 ? (
        <p className={estilos.vacio}>Sin gastos registrados.</p>
      ) : (
        <table className={estilos.tablaMini}>
          <thead>
            <tr>
              <th>Categoría</th><th>Descripción</th><th>Monto</th><th>Pagó</th>
              <th>Estado</th><th>Resolución</th>
            </tr>
          </thead>
          <tbody>
            {gastos.map(g => (
              <tr key={String(g.id)}>
                <td>{g.categoria}</td>
                <td>{g.descripcion}</td>
                <td className={estilos.num}>{miles(g.monto)}</td>
                <td>{g.pagadoPor}{g.reembolsable ? ' · reembolsable' : ''}</td>
                <td>{g.estado}</td>
                <td>{g.estado === 'pendiente'
                  ? <ResolverGasto gasto={g} accion={accion} />
                  : (g.motivoResolucion ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {abierto && <FormularioGasto viaje={viaje} accion={accion} />}
    </div>
  );
}

/**
 * Resolver un gasto exige motivo escrito, y el botón lo espera.
 *
 * La §21 pide poder reconstruir POR QUÉ se aceptó. Podría dejarse que el 400
 * del servidor lo explicara, pero entonces la primera vez que alguien aprueba
 * un gasto recibe un error por hacer lo obvio; y un error evitable enseña a
 * ignorar los errores.
 */
function ResolverGasto({ gasto, accion }: { gasto: Fila; accion: Accion }) {
  const [motivo, setMotivo] = useState('');

  return (
    <span className={estilos.acciones}>
      <Campo etiqueta={`Motivo para el gasto de ${gasto.categoria}`}
             valor={motivo} onCambio={setMotivo} />
      <Button deshabilitado={motivo.trim().length < 5}
              onClick={() => void accion(() =>
                api.actualizar(`/gastos/${gasto.id}`, { estado: 'aprobado', motivo }))}>
        Aprobar gasto
      </Button>
      <Button variante="secundario" deshabilitado={motivo.trim().length < 5}
              onClick={() => void accion(() =>
                api.actualizar(`/gastos/${gasto.id}`, { estado: 'rechazado', motivo }))}>
        Rechazar gasto
      </Button>
    </span>
  );
}

function FormularioGasto({ viaje, accion }: { viaje: Fila; accion: Accion }) {
  const [categoria, setCategoria] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');
  const [pagadoPor, setPagadoPor] = useState('conductor');
  const [comprobante, setComprobante] = useState('');
  const [reembolsable, setReembolsable] = useState(true);

  const completo = categoria && descripcion.trim().length >= 3 && Number(monto) > 0;

  return (
    <div className={estilos.formLinea}>
      <Campo etiqueta="Categoría" requerido valor={categoria} onCambio={setCategoria}
             opciones={CATEGORIAS.map(c => ({ valor: c, etiqueta: c }))} />
      <Campo etiqueta="Descripción del gasto" requerido valor={descripcion} onCambio={setDescripcion} />
      <Campo etiqueta="Monto" tipo="number" requerido valor={monto} onCambio={setMonto} />
      <Campo etiqueta="Quién pagó" valor={pagadoPor} onCambio={setPagadoPor}
             opciones={[{ valor: 'conductor', etiqueta: 'conductor' },
                        { valor: 'empresa', etiqueta: 'empresa' }]} />
      <Campo etiqueta="Comprobante" valor={comprobante} onCambio={setComprobante}
             ayuda="Sin comprobante el gasto entra igual, y una alerta lo señala." />

      {/* Reembolsable sólo tiene sentido si pagó el conductor: la base lo vigila
          con una CHECK que mira las dos columnas, y aquí se evita el viaje. */}
      {pagadoPor === 'conductor' && (
        <label className={estilos.casilla}>
          <input type="checkbox" checked={reembolsable}
                 onChange={e => setReembolsable(e.target.checked)} />
          <span className={estilos.casillaTexto}>
            Se le reembolsa al conductor
            <span className={estilos.casillaAyuda}>
              Entra en la liquidación del §10.7 en cuanto alguien lo apruebe.
            </span>
          </span>
        </label>
      )}

      <Button deshabilitado={!completo} onClick={() => void accion(async () => {
        await api.crear(`/gastos/viaje/${viaje.id}`, {
          categoria, descripcion, monto: Number(monto), pagadoPor,
          ...(comprobante ? { comprobante } : {}),
          ...(pagadoPor === 'conductor' ? { reembolsable } : {}),
        });
        setCategoria(''); setDescripcion(''); setMonto(''); setComprobante('');
      })}>
        Registrar gasto
      </Button>
    </div>
  );
}
