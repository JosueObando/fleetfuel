'use client';

import { useState } from 'react';
import { api } from '@/api/cliente';
import { useUsuarioActual } from '@/api/usuario-actual';
import { mensajeDeError, useBandeja } from '../useBandeja';
import { tipoDeSolicitud as tipoDe } from './tipos';
import type { Fila } from '@/api/tipos';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from '../bandeja.module.css';

/**
 * §2C · Solicitudes de cambio de ruta que esperan decisión.
 *
 * QUIEN PIDE NO RESUELVE: el servidor lo impide con un 409, y la pantalla ni
 * siquiera ofrece el gesto sobre lo propio. Quién es «yo» se lee de la sesión
 * con `useUsuarioActual`: durante la hidratación es nulo, y con nulo no se
 * ofrece resolver nada. Ofrecerlo todo sería ofrecer también lo propio.
 */

/** El mismo mínimo que `ResolverCambioRutaDto`. */
const MOTIVO_MINIMO = 5;

const cuando = (v: unknown) => new Date(String(v)).toLocaleString('es-PA', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Panama',
});

export function Solicitudes() {
  const yo = useUsuarioActual();

  const { filas, error, setError, recargar } =
    useBandeja('/solicitudes-ruta/pendientes', 'No se pudieron cargar las solicitudes');
  const [resultado, setResultado] = useState<string | null>(null);

  async function resolver(s: Fila, estado: 'aprobada' | 'rechazada', motivo: string) {
    setError(null); setResultado(null);
    try {
      await api.actualizar(`/solicitudes-ruta/${s.id}`, { estado, motivo });
      const t = tipoDe(s.tipo);
      const verbo = estado === 'aprobada' ? 'Aprobad' : 'Rechazad';
      setResultado(`${verbo}${t.genero} ${t.articulo} ${t.nombre.toLowerCase()} de ${String(s.codigoViaje)}.`);
      recargar();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo resolver la solicitud'));
    }
  }

  return (
    <section className={catalogo.panel}>
      <div className={catalogo.barra}>
        <h1 className={catalogo.titulo}>Solicitudes de ruta</h1>
      </div>

      <div className={catalogo.cuerpo}>
        {error && <p role="alert" className={catalogo.aviso}>{error}</p>}
        {resultado && <p role="status" className={estilos.resultado}>{resultado}</p>}

        {filas === null ? (
          <>{[0, 1, 2].map(i => <div key={i} className={catalogo.esqueleto} />)}</>
        ) : filas.length === 0 ? (
          !error && <p className={catalogo.vacio}>Ninguna solicitud espera decisión.</p>
        ) : (
          <ul className={estilos.lista}>
            {filas.map(s => (
              <li key={String(s.id)} className={estilos.elemento}>
                <div className={estilos.cabecera}>
                  <h2 className={estilos.titulo}>{tipoDe(s.tipo).nombre} · {String(s.codigoViaje)}</h2>
                </div>
                <p className={estilos.detalle}>{String(s.motivo)}</p>
                <p className={estilos.meta}>
                  Pedida por {String(s.solicitante)} · {cuando(s.solicitadaEn)}
                </p>

                {yo === null ? null : String(s.solicitadaPor) === yo ? (
                  <p className={estilos.cierre}>La pediste tú: tiene que resolverla otra persona.</p>
                ) : (
                  <Resolver solicitud={s} onResolver={(estado, motivo) => resolver(s, estado, motivo)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Resolver({ solicitud, onResolver }: {
  solicitud: Fila;
  onResolver: (estado: 'aprobada' | 'rechazada', motivo: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  const listo = motivo.trim().length >= MOTIVO_MINIMO;
  const cual = `${tipoDe(solicitud.tipo).nombre} de ${String(solicitud.codigoViaje)}`;
  return (
    <div className={estilos.acciones}>
      <span className={estilos.resolver}>
        <Campo etiqueta="Motivo de la decisión" valor={motivo} onCambio={setMotivo} />
      </span>
      <Button variante="secundario" deshabilitado={!listo}
              onClick={() => void onResolver('rechazada', motivo.trim())}>
        Rechazar<span className="solo-lectores"> {cual}</span>
      </Button>
      <Button deshabilitado={!listo}
              onClick={() => void onResolver('aprobada', motivo.trim())}>
        Aprobar<span className="solo-lectores"> {cual}</span>
      </Button>
    </div>
  );
}
