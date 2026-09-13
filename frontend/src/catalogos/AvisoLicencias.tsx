'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { api, ErrorApi } from '@/api/cliente';
import { useCargaInicial } from '@/api/carga';
import type { Fila } from '@/api/tipos';
import estilos from './AvisoLicencias.module.css';
import { TablaDesplazable } from '@/componentes/TablaDesplazable/TablaDesplazable';

/**
 * §6.6 · Vencimientos de licencia, encima de la tabla de conductores.
 *
 * POR QUÉ ESTÁ AQUÍ Y NO EN UNA PANTALLA PROPIA
 *
 * Lo que se hace al ver que una licencia vence es abrir ese conductor y
 * cambiarle la fecha. Esa tabla está justo debajo.
 *
 * LO QUE AÑADE SOBRE LA API
 *
 * La consulta del servidor es `fecha <= hoy + N días`, así que en la misma
 * lista vienen las que van a vencer y **las que ya vencieron**. No son lo
 * mismo: una licencia vencida no es un aviso con margen, es un conductor que
 * hoy no puede conducir. La API no puede separarlas por su cuenta sin inventar
 * dos endpoints; la pantalla sí, y es todo lo que aporta.
 */

const HORIZONTES = [30, 60, 90];

/** Días entre hoy y la fecha, por fecha civil y no por milisegundos: a nadie le
 *  importa si faltan 11,6 días, y redondear horas produce un «0 días» para algo
 *  que vence mañana. */
function diasHasta(fecha: string): number {
  const hoy = new Date().toISOString().slice(0, 10);
  const unDia = 86400000;
  return Math.round((Date.parse(fecha.slice(0, 10)) - Date.parse(hoy)) / unDia);
}

export function AvisoLicencias() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [horizonte, setHorizonte] = useState(30);

  const cargar = useCallback(async () => {
    try {
      /* `?dias=` explícito aunque el backend ya ponga 30 por omisión: el día que
         cambie ese valor, esta pantalla seguirá enseñando el horizonte que dice
         enseñar. Y es el parámetro que durante meses hacía fallar la ruta si
         NO se pasaba, así que va escrito a la vista. */
      const r = await api.listar<Fila>(`/conductores/licencias-por-vencer?dias=${horizonte}`);
      setFilas(r); setError(null);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudieron consultar los vencimientos');
      // `null` y no `[]`: una lista vacía diría que no hay ninguna por vencer,
      // que es una afirmación que nadie ha podido comprobar.
      setFilas(null);
    }
  }, [horizonte]);
  useCargaInicial(cargar);

  const conDias = (filas ?? []).map(f => ({
    fila: f,
    dias: diasHasta(String(f.fechaVencimientoLicencia ?? '')),
  }));
  /* Las vencidas primero. La API ordena por fecha ascendente, que casualmente
     hace lo mismo; se ordena aquí para que siga siendo cierto si eso cambia. */
  const ordenadas = [...conDias].sort((a, b) => a.dias - b.dias);
  const vencidas = conDias.filter(c => c.dias < 0).length;
  const porVencer = conDias.length - vencidas;

  return (
    <section className={estilos.aviso} aria-label="Vencimientos de licencia">
      <div className={estilos.barra}>
        <p role="status" aria-label="Licencias"
           className={vencidas > 0 ? estilos.conVencidas : undefined}>
          {error !== null ? error
            : filas === null ? 'Consultando vencimientos…'
            : conDias.length === 0
              ? `Ninguna licencia vence en los próximos ${horizonte} días.`
              : `${vencidas} vencida(s) · ${porVencer} por vencer en ${horizonte} días.`}
        </p>
        <div className={estilos.horizontes}>
          {HORIZONTES.map(d => (
            <Button key={d} variante="secundario"
                    onClick={() => setHorizonte(d)}
                    aria-pressed={d === horizonte}>
              {d} días
            </Button>
          ))}
        </div>
      </div>

      {ordenadas.length > 0 && (
        <TablaDesplazable etiqueta="Vencimientos de licencia">
        <table className={estilos.tabla}>
          <thead>
            <tr>
              <th scope="col">Conductor</th>
              <th scope="col">Licencia</th>
              <th scope="col">Vence</th>
              <th scope="col">Situación</th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map(({ fila, dias }) => (
              <tr key={String(fila.id)}>
                <td>{String(fila.nombreCompleto)}</td>
                <td>{String(fila.licencia)}</td>
                <td>{String(fila.fechaVencimientoLicencia).slice(0, 10)}</td>
                {/* En palabras y no en color: quien audita busca el texto, y
                    quien no distingue el rojo del ámbar necesita leerlo. */}
                <td className={dias < 0 ? estilos.vencida : undefined}>
                  {dias < 0
                    ? `Vencida hace ${Math.abs(dias)} días`
                    : dias === 0 ? 'Vence hoy' : `Faltan ${dias} días`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </TablaDesplazable>
      )}
    </section>
  );
}
