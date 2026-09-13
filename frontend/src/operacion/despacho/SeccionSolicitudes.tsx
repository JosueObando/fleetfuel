'use client';

import estilos from './despacho.module.css';
import { tipoDeSolicitud } from '@/operacion/solicitudes/tipos';
import type { Fila } from './tipos';

/**
 * §2C · Las solicitudes de cambio de ruta de ESTE viaje, para leerlas.
 *
 * Resolverlas vive en su bandeja, que es donde un despachador mira lo que espera
 * una decisión. Aquí se leen junto al resto del viaje porque, cuando una entrega
 * no cuadra, la primera pregunta es «¿por qué fue por ahí?», y la respuesta
 * —quién lo pidió, quién lo autorizó y por qué— es la traza que pide el §21.
 */

const ESTADOS: Record<string, string> = {
  pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada',
};

export function SeccionSolicitudes({ solicitudes }: { solicitudes: Fila[] }) {
  return (
    <section className={estilos.seccion} aria-label="Solicitudes de cambio de ruta">
      <h3 className={estilos.tituloSeccion}>Solicitudes de cambio de ruta</h3>

      {solicitudes.length === 0 ? (
        <p className={estilos.vacio}>Nadie ha pedido cambiar la ruta de este viaje.</p>
      ) : (
        <ul className={estilos.listaSolicitudes}>
          {solicitudes.map(s => (
            <li key={String(s.id)} className={estilos.solicitud}>
              <p className={estilos.solicitudCabecera}>
                <strong>{tipoDeSolicitud(s.tipo).nombre}</strong>
                {' · '}<span>{ESTADOS[String(s.estado)]}</span>
              </p>
              <p className={estilos.solicitudMotivo}>{String(s.motivo)}</p>
              <p className={estilos.bloqueDetalle}>
                Pedida por {String(s.solicitante)} el {String(s.solicitadaEn).slice(0, 16).replace('T', ' ')}
              </p>
              {s.estado === 'pendiente' ? (
                <p className={estilos.bloqueDetalle}>Se resuelve en «Solicitudes de ruta».</p>
              ) : (
                <p className={estilos.bloqueDetalle}>
                  {`${ESTADOS[String(s.estado)]} por ${String(s.resolvedor)}: ${String(s.motivoResolucion)}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
