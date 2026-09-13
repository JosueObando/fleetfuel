'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { api, ErrorApi } from '@/api/cliente';
import { useCargaInicial } from '@/api/carga';
import type { Fila } from '@/api/tipos';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from './administracion.module.css';
import { TablaDesplazable } from '@/componentes/TablaDesplazable/TablaDesplazable';

/**
 * §21 · Dispositivos con sesión.
 *
 * Revocar es la operación de emergencia del sistema: el equipo robado, o el que
 * se queda quien deja la empresa. Sin pantalla, la única forma de cortarle el
 * acceso a un aparato era un PATCH por curl — y quien necesita hacer eso lo
 * necesita en ese momento, no cuando encuentre a alguien que sepa.
 *
 * LO QUE AÑADE SOBRE LA API
 *
 * Enseñar el efecto REAL. Revocar toca dos mundos: la marca en Postgres impide
 * futuros logins y el borrado en Redis corta las sesiones YA abiertas. El
 * backend devuelve `sesionesCortadas` justamente por eso, y ese número es la
 * diferencia entre «lo hice» y «funcionó».
 */

const MOTIVO_MINIMO = 10;
const mensaje = (e: unknown, porDefecto: string) =>
  e instanceof ErrorApi ? e.message : porDefecto;

export function Dispositivos() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revocando, setRevocando] = useState<Fila | null>(null);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try { setFilas(await api.listar<Fila>('/dispositivos')); setError(null); }
    catch (e) {
      setError(mensaje(e, 'No se pudieron listar los dispositivos'));
      setFilas([]);
    }
  }, []);
  useCargaInicial(cargar);

  /* El dispositivo llega como argumento desde el bloque que ya comprobó que
     existe, en vez de releerlo del estado con un `if (!revocando) return`: esa
     guarda sólo estaba para contentar a TypeScript, no la podía alcanzar
     ningún camino —el formulario no existe sin dispositivo— y una rama que
     nadie puede recorrer se quita, no se cubre. */
  async function revocar(e: React.FormEvent, dispositivo: Fila) {
    e.preventDefault();
    if (motivo.trim().length < MOTIVO_MINIMO) {
      /* Se comprueba aquí y no se deja al servidor: esta operación se hace con
         prisa, que es justo cuando nadie escribe el porqué si no se le pide, y
         un 400 después de pulsar se lee como un estorbo. */
      setError(`Explica el motivo: al menos ${MOTIVO_MINIMO} caracteres. Queda auditado.`);
      return;
    }
    setGuardando(true); setError(null); setResultado(null);
    try {
      const r = await api.actualizar<Fila>(
        `/dispositivos/${dispositivo.id}/revocar`, { motivo: motivo.trim() });
      const cortadas = Number(r?.sesionesCortadas ?? 0);
      /* El cero se dice con todas las letras: un aparato sin sesión abierta se
         revoca igual —queda marcado y no podrá volver a entrar— y callarlo
         haría pensar que no pasó nada. */
      setResultado(cortadas > 0
        ? `Revocado. Se cortaron ${cortadas} sesion(es) abiertas.`
        : 'Revocado. No tenía ninguna sesión abierta; tampoco podrá abrir otra.');
      setRevocando(null); setMotivo('');
      await cargar();
    } catch (err) {
      setError(mensaje(err, 'No se pudo revocar'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className={catalogo.panel}>
      <div className={catalogo.barra}>
        <h1 className={catalogo.titulo}>Dispositivos</h1>
      </div>

      <div className={catalogo.cuerpo}>
        {revocando && (
          <form className={catalogo.formulario} onSubmit={e => void revocar(e, revocando)}>
            <h2 className={estilos.subtitulo}>
              Revocar {String(revocando.nombre ?? revocando.identificador)}
            </h2>
            <p className={estilos.nota}>
              Corta las sesiones abiertas de este aparato e impide que vuelva a
              entrar. De {String(revocando.usuario)}.
            </p>
            <Campo etiqueta="Motivo" valor={motivo} onCambio={setMotivo} requerido
                   ayuda="Queda en la auditoría junto a quién lo hizo y cuándo." />
            {error && <p className={catalogo.aviso}>{error}</p>}
            <div className={catalogo.pieFormulario}>
              <Button variante="secundario"
                      onClick={() => { setRevocando(null); setError(null); }}>
                Cancelar
              </Button>
              <Button tipo="submit" cargando={guardando}>Confirmar revocación</Button>
            </div>
          </form>
        )}

        {!revocando && error && <p className={catalogo.aviso}>{error}</p>}
        {resultado && <p role="status" className={estilos.resultado}>{resultado}</p>}

        {filas === null ? (
          <>{[0, 1, 2].map(i => <div key={i} className={catalogo.esqueleto} />)}</>
        ) : filas.length === 0 ? (
          !error && <p className={catalogo.vacio}>Ningún dispositivo registrado.</p>
        ) : (
          <TablaDesplazable etiqueta="Dispositivos">
          <table className={catalogo.tabla}>
            <thead>
              <tr>
                <th scope="col">Dispositivo</th>
                <th scope="col">De</th>
                <th scope="col">Plataforma</th>
                <th scope="col">Último uso</th>
                <th scope="col">Estado</th>
                <th scope="col"><span className="solo-lectores">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={String(f.id)}>
                  <td>
                    {String(f.nombre ?? '—')}
                    <span className={estilos.ruta}> {String(f.identificador)}</span>
                  </td>
                  <td>{String(f.usuario ?? '—')}</td>
                  <td>{String(f.plataforma ?? '—')}</td>
                  {/* «Nunca» y no una celda vacía: un aparato registrado que no
                      se ha usado jamás es justo el que conviene mirar. */}
                  <td>{f.ultimoUsoEn ? String(f.ultimoUsoEn).slice(0, 10) : 'Nunca'}</td>
                  <td className={f.revocadoEn ? undefined : estilos.riesgo}>
                    {f.revocadoEn ? 'Revocado' : 'Activo'}
                  </td>
                  <td>
                    <div className={catalogo.acciones}>
                      {!f.revocadoEn && (
                        <Button variante="secundario"
                                onClick={() => {
                                  setRevocando(f); setMotivo('');
                                  setError(null); setResultado(null);
                                }}>
                          Revocar
                          <span className="solo-lectores"> el dispositivo {String(f.identificador)}</span>
                        </Button>
                      )}
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
