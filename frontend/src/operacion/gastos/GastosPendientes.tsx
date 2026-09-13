'use client';

import { useState } from 'react';
import { api } from '@/api/cliente';
import type { Fila } from '@/api/tipos';
import { puedeDarPorBueno, useUsuarioActual } from '@/api/usuario-actual';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from '../bandeja.module.css';
import { mensajeDeError, useBandeja } from '../useBandeja';

/**
 * §7.17 · Los gastos que esperan aprobación, de todos los viajes.
 *
 * El trabajo de Finanzas se hace de una sentada, no viaje por viaje. Lo que
 * esta pantalla añade sobre la de despacho es la VISTA DE CONJUNTO —cuántos y
 * por cuánto— y que un gasto sin comprobante se vea antes de aprobarlo: el §22
 * alerta de él después, cuando ya está aprobado.
 */

/* Las cinco del §7.17 (`CATEGORIAS` del DTO). Sin respaldo para otras: la
   validación del backend no deja entrar ninguna más. */
const CATEGORIAS: Record<string, string> = {
  peaje: 'Peaje', viatico: 'Viático', reparacion: 'Reparación',
  estacionamiento: 'Estacionamiento', otro: 'Otro',
};

/** El mismo mínimo que `ResolverGastoDto`. */
const MOTIVO_MINIMO = 5;

const dinero = (v: unknown) =>
  Number(v).toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function GastosPendientes() {
  const yo = useUsuarioActual();
  const { filas, error, setError, recargar } =
    useBandeja('/gastos/pendientes', 'No se pudieron cargar los gastos');
  const [resultado, setResultado] = useState<string | null>(null);

  async function resolver(g: Fila, estado: 'aprobado' | 'rechazado', motivo: string) {
    setError(null); setResultado(null);
    try {
      await api.actualizar(`/gastos/${g.id}`, { estado, motivo });
      const verbo = estado === 'aprobado' ? 'Aprobado' : 'Rechazado';
      setResultado(`${verbo} el gasto de ${dinero(g.monto)} de ${String(g.codigoViaje)}.`);
      recargar();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo resolver el gasto'));
    }
  }

  const total = (filas ?? []).reduce((t, g) => t + Number(g.monto), 0);

  return (
    <section className={catalogo.panel}>
      <div className={catalogo.barra}>
        <h1 className={catalogo.titulo}>Gastos por aprobar</h1>
      </div>

      <div className={catalogo.cuerpo}>
        {error && <p role="alert" className={catalogo.aviso}>{error}</p>}
        {resultado && <p role="status" className={estilos.resultado}>{resultado}</p>}

        {filas === null ? (
          <>{[0, 1, 2].map(i => <div key={i} className={catalogo.esqueleto} />)}</>
        ) : filas.length === 0 ? (
          !error && <p className={catalogo.vacio}>Ningún gasto espera aprobación.</p>
        ) : (
          <>
            <p className={estilos.meta}>
              {filas.length === 1 ? '1 gasto espera aprobación' : `${filas.length} gastos esperan aprobación`},
              {' '}por {dinero(total)} en total.
            </p>
            <ul className={estilos.lista}>
              {filas.map(g => (
                <li key={String(g.id)} className={estilos.elemento}>
                  <div className={estilos.cabecera}>
                    <h2 className={estilos.titulo}>
                      {CATEGORIAS[String(g.categoria)]} · {String(g.codigoViaje)}
                    </h2>
                    <span className={estilos.estado}>{dinero(g.monto)}</span>
                  </div>
                  <p className={estilos.detalle}>{String(g.descripcion)}</p>
                  <p className={estilos.meta}>
                    {g.pagadoPor === 'conductor'
                      ? `Pagó el conductor${g.reembolsable ? ' · se le reembolsa' : ''}`
                      : 'Pagó la empresa'}
                    {' · '}registrado por {String(g.registrante)} el {String(g.fecha).slice(0, 10)}
                  </p>
                  <p className={estilos.meta}>
                    {g.comprobante
                      ? `Comprobante ${String(g.comprobante)}`
                      : <strong className={estilos.gravedad}>Sin comprobante</strong>}
                  </p>

                  {puedeDarPorBueno(yo, g.registradoPor) ? (
                    <Resolver gasto={g} onResolver={(estado, motivo) => resolver(g, estado, motivo)} />
                  ) : yo !== null && (
                    <p className={estilos.cierre}>Lo registraste tú: tiene que aprobarlo otra persona.</p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function Resolver({ gasto, onResolver }: {
  gasto: Fila;
  onResolver: (estado: 'aprobado' | 'rechazado', motivo: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  const listo = motivo.trim().length >= MOTIVO_MINIMO;
  const cual = `el gasto de ${CATEGORIAS[String(gasto.categoria)].toLowerCase()} de ${String(gasto.codigoViaje)}`;
  return (
    <div className={estilos.acciones}>
      <span className={estilos.resolver}>
        <Campo etiqueta="Motivo de la decisión" valor={motivo} onCambio={setMotivo} />
      </span>
      <Button variante="secundario" deshabilitado={!listo}
              onClick={() => void onResolver('rechazado', motivo.trim())}>
        Rechazar<span className="solo-lectores"> {cual}</span>
      </Button>
      <Button deshabilitado={!listo}
              onClick={() => void onResolver('aprobado', motivo.trim())}>
        Aprobar<span className="solo-lectores"> {cual}</span>
      </Button>
    </div>
  );
}
