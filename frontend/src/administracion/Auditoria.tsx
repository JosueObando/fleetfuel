'use client';

import { useCallback, useState } from 'react';
import { Campo } from '@/componentes/Campo/Campo';
import { api, ErrorApi } from '@/api/cliente';
import { useCargaInicial } from '@/api/carga';
import type { Fila } from '@/api/tipos';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from './administracion.module.css';
import { TablaDesplazable } from '@/componentes/TablaDesplazable/TablaDesplazable';

/**
 * §21 · La bitácora de auditoría.
 *
 * De SÓLO LECTURA, y no por falta de tiempo: no existe endpoint para escribir
 * en ella. Lo que llega lo pone el interceptor global, nunca una llamada de
 * negocio. Por eso esta pantalla no tiene un solo botón que escriba — uno de
 * editar sugeriría que una auditoría es algo que se retoca, que es lo contrario
 * de para qué existe.
 *
 * LO QUE AÑADE SOBRE LA API
 *
 * Traducir `valorAnterior` y `valorNuevo` —dos objetos JSON— a QUÉ CAMBIÓ.
 * Volcar el JSON en una celda enseña el dato sin responder la pregunta que trae
 * quien abre una auditoría, que siempre es la misma: qué se tocó, quién y por
 * qué.
 */

/* Las entidades que audita el sistema hoy. Es una lista corta y explícita:
   deducirla de los registros cargados haría que el filtro sólo ofreciera lo que
   ya se está viendo, que es justo cuando no sirve. */
const ENTIDADES = [
  'usuarios', 'roles', 'dispositivos', 'clientes', 'estaciones', 'productos',
  'vehiculos', 'cisternas', 'conductores', 'ordenes', 'viajes', 'cargas',
  'entregas', 'gastos', 'liquidaciones', 'eventos_viaje',
];

const TOPES = ['50', '100', '250', '500'];

const comoTexto = (v: unknown) =>
  v === null || v === undefined ? '—'
    : typeof v === 'object' ? JSON.stringify(v)
    : String(v);

/**
 * El cambio, en palabras.
 *
 * Recorre la UNIÓN de las claves de los dos lados: un campo que sólo está en el
 * nuevo es un alta, y uno que sólo está en el anterior es un borrado. Mirar
 * sólo las del nuevo perdería el segundo caso sin avisar.
 */
function describirCambio(anterior: unknown, nuevo: unknown): string {
  const a = (anterior ?? {}) as Record<string, unknown>;
  const n = (nuevo ?? {}) as Record<string, unknown>;
  const claves = [...new Set([...Object.keys(a), ...Object.keys(n)])];
  if (claves.length === 0) return '—';

  return claves.map(k => {
    const antes = a[k];
    const despues = n[k];
    // Sin «anterior» es un alta: escribir «null → X» sugeriría que antes había
    // algo y que valía «null».
    if (anterior === null || anterior === undefined || !(k in a)) {
      return `${k}: ${comoTexto(despues)}`;
    }
    if (!(k in n)) return `${k}: ${comoTexto(antes)} → (quitado)`;
    if (comoTexto(antes) === comoTexto(despues)) return `${k}: ${comoTexto(antes)}`;
    return `${k}: ${comoTexto(antes)} → ${comoTexto(despues)}`;
  }).join(' · ');
}

export function Auditoria() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entidad, setEntidad] = useState('');
  const [limite, setLimite] = useState('100');

  const cargar = useCallback(async () => {
    /* El filtro va en la CONSULTA y no en el navegador. La API tope a 500
       registros: filtrar aquí enseñaría «los usuarios que aparecen en los
       últimos 100 cambios», que no es lo mismo que «los últimos 100 cambios
       sobre usuarios» y se parece lo justo para que nadie lo note. */
    const consulta = `/auditoria?limite=${limite}${entidad ? `&entidad=${entidad}` : ''}`;
    try {
      setFilas(await api.listar<Fila>(consulta));
      setError(null);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo leer la auditoría');
      setFilas([]);
    }
  }, [entidad, limite]);
  useCargaInicial(cargar);

  return (
    <section className={catalogo.panel}>
      <div className={catalogo.barra}>
        <h1 className={catalogo.titulo}>Auditoría</h1>
      </div>

      <div className={catalogo.cuerpo}>
        <div className={estilos.filtros}>
          <Campo etiqueta="Entidad" valor={entidad} onCambio={setEntidad}
                 opciones={ENTIDADES.map(e => ({ valor: e, etiqueta: e }))} />
          <Campo etiqueta="Cuántos" valor={limite} onCambio={setLimite}
                 opciones={TOPES.map(t => ({ valor: t, etiqueta: t }))}
                 ayuda="La API entrega 500 como máximo." />
        </div>

        {error && <p className={catalogo.aviso}>{error}</p>}

        {filas === null ? (
          <>{[0, 1, 2, 3].map(i => <div key={i} className={catalogo.esqueleto} />)}</>
        ) : filas.length === 0 ? (
          !error && <p className={catalogo.vacio}>Ningún movimiento con esos filtros.</p>
        ) : (
          <TablaDesplazable etiqueta="Auditoría">
          <table className={catalogo.tabla}>
            <thead>
              <tr>
                <th scope="col">Cuándo</th>
                <th scope="col">Acción</th>
                <th scope="col">Entidad</th>
                <th scope="col">Qué cambió</th>
                <th scope="col">Motivo</th>
                <th scope="col">Origen</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={String(f.id)}>
                  <td>{String(f.ocurridoEn ?? '').slice(0, 16).replace('T', ' ')}</td>
                  <td>{String(f.accion)}</td>
                  <td>{String(f.entidad)} · {String(f.entidadId ?? '—')}</td>
                  <td className={estilos.cambio}>
                    {describirCambio(f.valorAnterior, f.valorNuevo)}
                  </td>
                  <td>{f.motivo ? String(f.motivo) : '—'}</td>
                  <td className={estilos.origen}>
                    <span>{String(f.ip ?? '—')}</span>
                    <span className={estilos.ruta}>{String(f.ruta ?? '')}</span>
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
