'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { api, ErrorApi } from '@/api/cliente';
import { useCargaInicial } from '@/api/carga';
import type { Fila } from '@/api/tipos';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from './cisternas.module.css';
import { TablaDesplazable } from '@/componentes/TablaDesplazable/TablaDesplazable';

/*
 * Cisternas no usa el molde genérico: sus compartimentos son filas anidadas
 * con dos reglas propias —la suma no puede exceder el tanque y los números no
 * se repiten— y se crean CON la cisterna, en la misma petición. Forzar eso en
 * el formulario genérico costaría más de lo que ahorra.
 */

interface Compartimento {
  numero: string; capacidadNominal: string; capacidadCalibrada: string; productoPermitido: string;
}

const COMP_VACIO = (n: number): Compartimento => ({
  numero: String(n), capacidadNominal: '', capacidadCalibrada: '', productoPermitido: '',
});

export default function Cisternas() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [vehiculos, setVehiculos] = useState<Fila[]>([]);
  const [productos, setProductos] = useState<Fila[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [vehiculoId, setVehiculoId] = useState('');
  const [capacidadTotal, setCapacidadTotal] = useState('');
  const [certificado, setCertificado] = useState('');
  const [fechaCal, setFechaCal] = useState('');
  const [fechaProx, setFechaProx] = useState('');
  const [material, setMaterial] = useState('');
  const [comps, setComps] = useState<Compartimento[]>([COMP_VACIO(1)]);

  const cargar = useCallback(async () => {
    try { setFilas(await api.listar<Fila>('/cisternas')); setError(null); }
    catch (e) { setError(e instanceof ErrorApi ? e.message : 'No se pudo cargar'); setFilas([]); }
  }, []);
  useCargaInicial(cargar);

  useEffect(() => {
    if (!abierto) return;
    /* Solo cabezal y unidad integrada pueden llevar cisterna: la API lo
       rechaza igualmente, pero filtrar aquí evita ofrecer una opción que se
       sabe que va a fallar. */
    void api.listar<Fila>('/vehiculos')
      .then(vs => setVehiculos(vs.filter(v => ['cisterna', 'integrada'].includes(v.tipoVehiculo))))
      .catch(() => undefined);
    void api.listar<Fila>('/productos').then(setProductos).catch(() => undefined);
  }, [abierto]);

  const suma = comps.reduce((t, c) => t + (Number(c.capacidadNominal) || 0), 0);
  const total = Number(capacidadTotal) || 0;
  const excede = total > 0 && suma > total;

  function tocar(i: number, campo: keyof Compartimento, valor: string) {
    setComps(cs => cs.map((c, j) => (j === i ? { ...c, [campo]: valor } : c)));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(null);
    try {
      await api.crear('/cisternas', {
        vehiculoId,
        capacidadTotal: Number(capacidadTotal),
        ...(certificado ? { certificadoCalibracion: certificado } : {}),
        ...(fechaCal ? { fechaCalibracion: fechaCal } : {}),
        ...(fechaProx ? { fechaProximaCalibracion: fechaProx } : {}),
        ...(material ? { material } : {}),
        compartimentos: comps.map(c => ({
          numero: Number(c.numero),
          capacidadNominal: Number(c.capacidadNominal),
          capacidadCalibrada: Number(c.capacidadCalibrada),
          ...(c.productoPermitido ? { productoPermitido: c.productoPermitido } : {}),
        })),
      });
      setAbierto(false);
      setVehiculoId(''); setCapacidadTotal(''); setCertificado('');
      setFechaCal(''); setFechaProx(''); setMaterial(''); setComps([COMP_VACIO(1)]);
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo guardar');
    } finally { setGuardando(false); }
  }

  async function darDeBaja(fila: Fila) {
    if (!window.confirm(`¿Dar de baja la cisterna de ${fila.placa}?`)) return;
    try { await api.desactivar(`/cisternas/${fila.id}`); await cargar(); }
    catch (err) { setError(err instanceof ErrorApi ? err.message : 'No se pudo dar de baja'); }
  }

  return (
    <section className={catalogo.panel}>
      <div className={catalogo.barra}>
        <h1 className={catalogo.titulo}>Cisternas</h1>
        <Button icono="mas" onClick={() => setAbierto(a => !a)}>Nueva cisterna</Button>
      </div>

      <div className={catalogo.cuerpo}>
        {abierto && (
          <form className={catalogo.formulario} onSubmit={guardar}>
            <Campo etiqueta="Vehículo" requerido valor={vehiculoId} onCambio={setVehiculoId}
                   ayuda="Solo cisternas y unidades integradas."
                   opciones={vehiculos.map(v => ({ valor: String(v.id), etiqueta: `${v.placa} · ${v.marca ?? ''}` }))} />
            <Campo etiqueta="Capacidad total" tipo="number" requerido
                   valor={capacidadTotal} onCambio={setCapacidadTotal} />
            <Campo etiqueta="Certificado de calibración" valor={certificado} onCambio={setCertificado} />
            <Campo etiqueta="Fecha de calibración" tipo="date" valor={fechaCal} onCambio={setFechaCal} />
            <Campo etiqueta="Próxima calibración" tipo="date" valor={fechaProx} onCambio={setFechaProx} />
            <Campo etiqueta="Material" valor={material} onCambio={setMaterial} />

            <div className={estilos.compartimentos}>
              <div className={estilos.cabeceraComp}>
                <span className={estilos.tituloComp}>Compartimentos</span>
                {/* La suma se muestra SIEMPRE, no solo al fallar: así se ve
                    cuánto queda mientras se rellena, en vez de descubrir el
                    exceso al enviar. */}
                <span className={`${estilos.suma} ${excede ? estilos.excedida : ''}`} aria-live="polite">
                  {suma.toLocaleString('es-PA')} de {total ? total.toLocaleString('es-PA') : '—'}
                  {excede && ' · excede la capacidad'}
                </span>
              </div>

              <ul className={estilos.listaComp}>
                {comps.map((c, i) => (
                  <li key={i} className={estilos.filaComp}>
                    <Campo etiqueta="N.º" tipo="number" requerido valor={c.numero}
                           onCambio={v => tocar(i, 'numero', v)} />
                    <Campo etiqueta="Nominal" tipo="number" requerido valor={c.capacidadNominal}
                           onCambio={v => tocar(i, 'capacidadNominal', v)} />
                    <Campo etiqueta="Calibrada" tipo="number" requerido valor={c.capacidadCalibrada}
                           onCambio={v => tocar(i, 'capacidadCalibrada', v)} />
                    <Campo etiqueta="Producto permitido" valor={c.productoPermitido}
                           onCambio={v => tocar(i, 'productoPermitido', v)}
                           opciones={productos.map(p => ({ valor: String(p.id), etiqueta: String(p.nombre) }))} />
                    <Button variante="secundario" deshabilitado={comps.length === 1}
                            onClick={() => setComps(cs => cs.filter((_, j) => j !== i))}>
                      Quitar<span className="solo-lectores"> compartimento {c.numero}</span>
                    </Button>
                  </li>
                ))}
              </ul>

              <Button variante="secundario" icono="mas" deshabilitado={comps.length >= 12}
                      onClick={() => setComps(cs => [...cs, COMP_VACIO(cs.length + 1)])}>
                Añadir compartimento
              </Button>
            </div>

            {error && <p className={catalogo.aviso}>{error}</p>}
            <div className={catalogo.pieFormulario}>
              <Button variante="secundario" onClick={() => setAbierto(false)}>Cancelar</Button>
              <Button tipo="submit" cargando={guardando} deshabilitado={excede}>Crear cisterna</Button>
            </div>
          </form>
        )}

        {!abierto && error && <p className={catalogo.aviso}>{error}</p>}

        {filas === null ? (
          <>{[0, 1, 2].map(i => <div key={i} className={catalogo.esqueleto} />)}</>
        ) : filas.length === 0 ? (
          <p className={catalogo.vacio}>Todavía no hay cisternas.</p>
        ) : (
          <TablaDesplazable etiqueta="Cisternas">
          <table className={catalogo.tabla}>
            <thead>
              <tr>
                <th scope="col">Placa</th><th scope="col">Capacidad</th>
                <th scope="col">Comp.</th><th scope="col">Calibración</th>
                <th scope="col">Estado</th><th scope="col"><span className="solo-lectores">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={String(f.id)}>
                  <td>{f.placa}</td>
                  <td className={catalogo.numerico}>{Number(f.capacidadTotal).toLocaleString('es-PA')}</td>
                  <td className={catalogo.numerico}>{f.cantidadCompartimentos}</td>
                  <td>
                    {f.fechaProximaCalibracion ? String(f.fechaProximaCalibracion).slice(0, 10) : '—'}
                    {f.calibracionVencida && <span className={estilos.chip}>vencida</span>}
                  </td>
                  <td>{f.estado}</td>
                  <td>
                    <div className={catalogo.acciones}>
                      <Button variante="secundario" onClick={() => void darDeBaja(f)}>
                        Dar de baja<span className="solo-lectores"> {String(f.placa)}</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </TablaDesplazable>
        )}
      </div>
    </section>
  );
}
