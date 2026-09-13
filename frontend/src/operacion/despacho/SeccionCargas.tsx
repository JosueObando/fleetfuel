'use client';

import { useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { api } from '@/api/cliente';
import estilos from './despacho.module.css';
import type { Fila, Accion } from './tipos';

/**
 * §7.13 · La carga en terminal (Etapa 5 del §9).
 *
 * Sólo se registra mientras el viaje está `cargando`, que es lo que el servicio
 * exige. Ofrecer el formulario en cualquier otro estado sería ofrecer un 409.
 */
export function SeccionCargas({ viaje, cargas, accion }: {
  viaje: Fila; cargas: Fila[]; accion: Accion;
}) {
  const registrable = viaje.estado === 'cargando';

  return (
    <div className={estilos.seccion}>
      <h3 className={estilos.tituloSeccion}>Carga en terminal</h3>

      {cargas.length === 0 ? (
        <p className={estilos.vacio}>
          {registrable
            ? 'Todavía no se ha registrado ninguna carga de este viaje.'
            : 'Este viaje no tiene cargas registradas en terminal.'}
        </p>
      ) : (
        <table className={estilos.tablaMini}>
          <thead>
            <tr>
              <th>Comp.</th><th>Sello</th><th>Programado</th><th>Cargado</th>
              <th>Dif.</th><th>Operador</th><th>Validación</th><th />
            </tr>
          </thead>
          <tbody>
            {cargas.map(c => (
              <tr key={String(c.id)}>
                <td className={estilos.num}>{c.compartimento ?? c.compartimentoId}</td>
                <td className={estilos.sello}>{c.numeroSello}</td>
                <td className={estilos.num}>{miles(c.volumenProgramado)}</td>
                <td className={estilos.num}>{miles(c.volumenCargado)}</td>
                <td className={estilos.num}>{miles(c.diferenciaProgramado)}</td>
                <td>{c.operadorTerminal}</td>
                <td>{c.estadoValidacion}</td>
                <td>
                  {/* Validar es un acto propio con permiso propio: quien
                      confirma el volumen que salió no lo da por bueno. Por eso
                      es un botón aparte y no una casilla del formulario. */}
                  {c.estadoValidacion === 'pendiente' && (
                    <span className={estilos.acciones}>
                      <Button onClick={() => void accion(() =>
                        api.crear(`/cargas/${c.id}/validar`, {}))}>
                        Validar<span className="solo-lectores"> la carga del sello {c.numeroSello}</span>
                      </Button>
                      <Button variante="secundario" onClick={() => void accion(async () => {
                        const motivo = window.prompt('Motivo del rechazo:');
                        if (!motivo) return;
                        await api.crear(`/cargas/${c.id}/rechazar`, { motivo });
                      })}>
                        Rechazar<span className="solo-lectores"> la carga del sello {c.numeroSello}</span>
                      </Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {registrable && <FormularioCarga viaje={viaje} cargas={cargas} accion={accion} />}
    </div>
  );
}

function FormularioCarga({ viaje, cargas, accion }: {
  viaje: Fila; cargas: Fila[]; accion: Accion;
}) {
  const [linea, setLinea] = useState('');
  const [volumen, setVolumen] = useState('');
  const [sello, setSello] = useState('');
  const [operador, setOperador] = useState('');
  const [medidorInicial, setMedidorInicial] = useState('');
  const [medidorFinal, setMedidorFinal] = useState('');
  const [temperatura, setTemperatura] = useState('');
  const [densidad, setDensidad] = useState('');
  const [latitud, setLatitud] = useState('');
  const [longitud, setLongitud] = useState('');

  /* Sólo las líneas del plan que TODAVÍA no se han cargado: un compartimento
     lleva una carga por viaje (regla 5), así que volver a ofrecerlo sería
     ofrecer el conflicto que la base ya rechaza. */
  const yaCargados = new Set(cargas.map(c => String(c.compartimentoId)));
  const pendientes = (viaje.planCarga ?? []).filter(
    (l: Fila) => !yaCargados.has(String(l.compartimentoId)));

  const elegida = pendientes.find((l: Fila) => clave(l) === linea);
  const calibrada = elegida ? Number(elegida.capacidadCalibrada) : 0;
  const cabe = !volumen || !calibrada || Number(volumen) <= calibrada;
  const completo = linea && volumen && sello && operador && latitud && longitud && cabe;

  if (pendientes.length === 0) {
    return <p className={estilos.vacio}>Todo el plan de carga de este viaje ya está cargado.</p>;
  }

  return (
    <div className={estilos.formLinea}>
      <Campo etiqueta="Compartimento del plan" valor={linea} onCambio={setLinea}
             opciones={pendientes.map((l: Fila) => ({
               valor: clave(l),
               etiqueta: `N.º ${l.compartimento} · ${l.producto} · plan ${miles(l.volumenPlanificado)}`,
             }))} />
      <Campo etiqueta="Volumen cargado" tipo="number" valor={volumen} onCambio={setVolumen}
             error={cabe ? undefined : `No caben más de ${miles(calibrada)} calibrados`}
             ayuda="Lo que la terminal echó de verdad, no lo planificado." />
      {/* El sello NACE aquí. Es el origen de la cadena de custodia: lo que la
          entrega comparará después contra lo que lea en la estación. */}
      <Campo etiqueta="Número de sello" requerido valor={sello} onCambio={setSello} />
      <Campo etiqueta="Operador de la terminal" requerido valor={operador} onCambio={setOperador} />
      <Campo etiqueta="Medidor inicial" tipo="number" valor={medidorInicial} onCambio={setMedidorInicial}
             ayuda="Los medidores van en pareja o no van." />
      <Campo etiqueta="Medidor final" tipo="number" valor={medidorFinal} onCambio={setMedidorFinal} />
      <Campo etiqueta="Temperatura" tipo="number" valor={temperatura} onCambio={setTemperatura} />
      <Campo etiqueta="Densidad" tipo="number" valor={densidad} onCambio={setDensidad} />
      <Campo etiqueta="Latitud" tipo="number" requerido valor={latitud} onCambio={setLatitud} />
      <Campo etiqueta="Longitud" tipo="number" requerido valor={longitud} onCambio={setLongitud} />

      <Button deshabilitado={!completo} onClick={() => void accion(async () => {
        await api.crear(`/cargas/viaje/${viaje.id}`, {
          compartimentoId: elegida!.compartimentoId,
          detalleOrdenId: elegida!.detalleOrdenId,
          volumenCargado: Number(volumen),
          numeroSello: sello, operadorTerminal: operador,
          latitud: Number(latitud), longitud: Number(longitud),
          ...(medidorInicial ? { medidorInicial: Number(medidorInicial) } : {}),
          ...(medidorFinal ? { medidorFinal: Number(medidorFinal) } : {}),
          ...(temperatura ? { temperatura: Number(temperatura) } : {}),
          ...(densidad ? { densidad: Number(densidad) } : {}),
        });
        setLinea(''); setVolumen(''); setSello(''); setOperador('');
        setMedidorInicial(''); setMedidorFinal(''); setTemperatura(''); setDensidad('');
      })}>
        Registrar carga
      </Button>
    </div>
  );
}

const clave = (l: Fila) => `${l.compartimentoId}:${l.detalleOrdenId}`;

export function miles(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('es-PA', { maximumFractionDigits: 2 }) : '—';
}
