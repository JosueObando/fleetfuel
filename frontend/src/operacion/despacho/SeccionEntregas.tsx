'use client';

import { useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { api } from '@/api/cliente';
import estilos from './despacho.module.css';
import { miles } from './SeccionCargas';
import type { Fila, Accion } from './tipos';

/**
 * §7.14 · La entrega en estación (Etapa 7 del §9), y la mitad visible de la
 * regla 18.
 *
 * POR QUÉ ESTA PANTALLA NO DEJA DECIR «INTACTO»
 *
 * Desde el 2026-09-12 el servidor compara `selloRecibido` contra el
 * `numero_sello` de la carga y decide él la coincidencia. Si la pantalla
 * ofreciera un desplegable con «intacto / roto / inconsistente» estaría
 * contando otra historia —que la palabra de quien recibe zanja el asunto— y esa
 * contradicción termina en «el sistema está mal: pongo intacto y me lo cambia».
 *
 * Lo que sí se le pregunta a la persona es lo único que sólo ella puede saber:
 * si el precinto llegó FÍSICAMENTE roto. Puede empeorar el veredicto; nunca
 * retirarlo.
 */
export function SeccionEntregas({ viaje, cargas, entregas, lineas, accion }: {
  viaje: Fila; cargas: Fila[]; entregas: Fila[]; lineas: Fila[]; accion: Accion;
}) {
  const registrable = viaje.estado === 'descargando';

  return (
    <div className={estilos.seccion}>
      <h3 className={estilos.tituloSeccion}>Entregas en estación</h3>

      {entregas.length === 0 ? (
        <p className={estilos.vacio}>
          {registrable
            ? 'Todavía no se ha registrado ninguna entrega de este viaje.'
            : 'Este viaje no tiene entregas registradas.'}
        </p>
      ) : (
        <table className={estilos.tablaMini}>
          <thead>
            <tr>
              <th>Comp.</th><th>Cargado</th><th>Recibido</th><th>Merma</th>
              <th>Sello</th><th>Precinto</th><th>Estado</th><th />
            </tr>
          </thead>
          <tbody>
            {entregas.map(e => (
              <tr key={String(e.id)}>
                <td className={estilos.num}>{e.compartimento ?? e.compartimentoId}</td>
                <td className={estilos.num}>{miles(e.volumenCargado)}</td>
                <td className={estilos.num}>{miles(e.volumenRecibido)}</td>
                <td className={estilos.num}>{porcentaje(e.porcentajeMerma)}</td>
                <td className={estilos.sello}>{e.selloRecibido ?? '—'}</td>
                <td>{e.estadoSello ?? '—'}</td>
                <td>{e.estado}</td>
                <td>
                  {/* Regla 9 · Aprobar una diferencia es un acto de otro rol.
                      Aparece siempre que la entrega esté pendiente: si el rol no
                      tiene `entregas:aprobar`, el 403 se cuenta arriba. */}
                  {e.estado === 'pendiente' && (
                    <span className={estilos.acciones}>
                      <Button onClick={() => void accion(async () => {
                        const motivo = window.prompt('Motivo por el que se acepta la diferencia:');
                        if (!motivo) return;
                        await api.crear(`/entregas/${e.id}/aprobar`, { motivo });
                      })}>
                        Aprobar entrega
                      </Button>
                      <Button variante="secundario" onClick={() => void accion(async () => {
                        const motivo = window.prompt('Motivo del rechazo:');
                        if (!motivo) return;
                        await api.crear(`/entregas/${e.id}/rechazar`, { motivo });
                      })}>
                        Rechazar entrega
                      </Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {registrable && (
        <FormularioEntrega viaje={viaje} cargas={cargas} entregas={entregas}
                           lineas={lineas} accion={accion} />
      )}
    </div>
  );
}

function FormularioEntrega({ viaje, cargas, entregas, lineas, accion }: {
  viaje: Fila; cargas: Fila[]; entregas: Fila[]; lineas: Fila[]; accion: Accion;
}) {
  const [cargaId, setCargaId] = useState('');
  const [recibido, setRecibido] = useState('');
  const [sello, setSello] = useState('');
  const [receptor, setReceptor] = useState('');
  const [documento, setDocumento] = useState('');
  const [latitud, setLatitud] = useState('');
  const [longitud, setLongitud] = useState('');
  const [roto, setRoto] = useState(false);

  /* Sólo las cargas que aún no se han entregado. Una carga entregada dos veces
     duplicaría el volumen contra la línea de la orden. */
  const yaEntregadas = new Set(entregas.map(e => String(e.cargaId)));
  const disponibles = cargas.filter(c => !yaEntregadas.has(String(c.id)));

  /* Con una sola carga pendiente no hay nada que elegir: se toma. Un
     desplegable de un elemento es un paso que no decide nada. */
  const carga = disponibles.length === 1
    ? disponibles[0]
    : disponibles.find(c => String(c.id) === cargaId);

  const cargado = carga ? Number(carga.volumenCargado) : 0;
  const linea = carga ? lineas.find(l => String(l.id) === String(carga.detalleOrdenId)) : undefined;
  const tolerancia = Number(linea?.tolerancia ?? 0);

  /* §10.5 · La merma se mide contra lo CARGADO, no contra el plan. Se calcula
     aquí en vivo para que quien captura vea si va a necesitar la firma de otro
     ANTES de mandar, en vez de descubrirlo por el estado que le devuelvan. */
  const merma = cargado > 0 && recibido !== ''
    ? ((cargado - Number(recibido)) / cargado) * 100
    : null;
  const fuera = merma !== null && tolerancia > 0 && Math.abs(merma) > tolerancia;

  const completo = carga && recibido !== '' && sello && receptor && latitud && longitud;

  if (disponibles.length === 0) {
    return (
      <p className={estilos.vacio}>
        {cargas.length === 0
          ? 'No hay ninguna carga en terminal, así que no hay nada que entregar.'
          : 'Todas las cargas de este viaje ya tienen su entrega.'}
      </p>
    );
  }

  return (
    <div className={estilos.formLinea}>
      {disponibles.length > 1 && (
        <Campo etiqueta="Carga que se descarga" valor={cargaId} onCambio={setCargaId}
               opciones={disponibles.map(c => ({
                 valor: String(c.id),
                 etiqueta: `Comp. ${c.compartimento ?? c.compartimentoId} · sello ${c.numeroSello}`,
               }))} />
      )}

      {/* El sello de la carga se MUESTRA para poder compararlo con el físico,
          y se muestra como dato, no como valor por omisión de un campo: si
          viniera precargado bastaría con no tocarlo para que siempre cuadrara. */}
      {carga && (
        <p className={estilos.conciliacion}>
          Salió de la terminal con <strong className={estilos.sello}>{carga.numeroSello}</strong>
          {' '}y {miles(carga.volumenCargado)} cargados.
        </p>
      )}

      <Campo etiqueta="Volumen recibido" tipo="number" requerido
             valor={recibido} onCambio={setRecibido}
             ayuda="Lo que la estación acepta. Manda en la conciliación." />
      <Campo etiqueta="Sello leído en la estación" requerido valor={sello} onCambio={setSello}
             ayuda="Cópialo del precinto físico, no del renglón de arriba." />
      <Campo etiqueta="Quién recibe" requerido valor={receptor} onCambio={setReceptor} />
      <Campo etiqueta="Documento de quien recibe" valor={documento} onCambio={setDocumento} />
      <Campo etiqueta="Latitud" tipo="number" requerido valor={latitud} onCambio={setLatitud}
             ayuda="Regla 8: toda entrega lleva su ubicación." />
      <Campo etiqueta="Longitud" tipo="number" requerido valor={longitud} onCambio={setLongitud} />

      <label className={estilos.casilla}>
        <input type="checkbox" checked={roto} onChange={e => setRoto(e.target.checked)} />
        <span className={estilos.casillaTexto}>
          El precinto llegó roto
          <span className={estilos.casillaAyuda}>
            Marca esto sólo por lo que veas en el camión. Que el NÚMERO coincida
            lo comprueba el sistema contra el de la terminal; no hace falta —ni
            se puede— declararlo intacto.
          </span>
        </span>
      </label>

      {merma !== null && (
        <p className={`${estilos.conciliacion} ${fuera ? estilos.fuera : ''}`}
           role={fuera ? 'status' : undefined}>
          Merma: {porcentaje(merma)} sobre lo cargado
          {tolerancia > 0 && ` · tolerancia ${porcentaje(tolerancia)}`}
          {fuera && ' · fuera de tolerancia: necesitará aprobación de otra persona.'}
        </p>
      )}

      <Button deshabilitado={!completo} onClick={() => void accion(async () => {
        await api.crear(`/entregas/viaje/${viaje.id}`, {
          detalleOrdenId: carga!.detalleOrdenId,
          compartimentoId: carga!.compartimentoId,
          volumenRecibido: Number(recibido),
          selloRecibido: sello,
          receptorNombre: receptor,
          latitud: Number(latitud), longitud: Number(longitud),
          ...(documento ? { receptorDocumento: documento } : {}),
          // Sin `estadoSello` cuando nadie ha visto nada raro: la ausencia deja
          // que el servidor concluya, que es de quien es esa decisión.
          ...(roto ? { estadoSello: 'roto' } : {}),
        });
        setCargaId(''); setRecibido(''); setSello(''); setReceptor('');
        setDocumento(''); setLatitud(''); setLongitud(''); setRoto(false);
      })}>
        Registrar entrega
      </Button>
    </div>
  );
}

export function porcentaje(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('es-PA', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} %`;
}
