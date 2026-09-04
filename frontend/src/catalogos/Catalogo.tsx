'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { api, ErrorApi } from '@/api/cliente';
import type { CatalogoDef } from './definiciones';
import estilos from './Catalogo.module.css';

type Fila = Record<string, unknown>;

/** Convierte el formulario (todo texto) al cuerpo que espera la API. */
function aCuerpo(def: CatalogoDef, valores: Record<string, string>) {
  const cuerpo: Record<string, unknown> = {};
  for (const campo of def.campos) {
    const v = valores[campo.nombre];
    // Cadena vacía ≠ null: se omite el campo. Mandar "" a un campo numérico o
    // de fecha produce un 400 críptico sobre un campo que la persona ni tocó.
    if (v === undefined || v === '') continue;
    cuerpo[campo.nombre] = campo.tipo === 'number' ? Number(v) : v;
  }
  return cuerpo;
}

export function Catalogo({ def }: { def: CatalogoDef }) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [referencias, setReferencias] = useState<Record<string, Fila[]>>({});

  const cargar = useCallback(async () => {
    try {
      setFilas(await api.listar<Fila>(def.ruta));
      setError(null);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo cargar la lista');
      setFilas([]);
    }
  }, [def.ruta]);

  useEffect(() => { void cargar(); }, [cargar]);

  /* Las opciones de los campos de referencia se piden una vez al abrir el
     formulario, no en cada pulsación: son catálogos, no búsquedas. */
  useEffect(() => {
    if (!abierto) return;
    for (const campo of def.campos) {
      if (!campo.referencia || referencias[campo.nombre]) continue;
      void api.listar<Fila>(campo.referencia.ruta)
        .then(rs => setReferencias(prev => ({ ...prev, [campo.nombre]: rs })))
        .catch(() => undefined);
    }
  }, [abierto, def.campos, referencias]);

  function abrirAlta() {
    setEditando(null); setValores({}); setError(null); setAbierto(true);
  }

  function abrirEdicion(fila: Fila) {
    const iniciales: Record<string, string> = {};
    for (const campo of def.campos) {
      const v = fila[campo.nombre];
      // Las fechas llegan en ISO completo y el input type=date quiere YYYY-MM-DD.
      iniciales[campo.nombre] = v === null || v === undefined ? ''
        : campo.tipo === 'date' ? String(v).slice(0, 10) : String(v);
    }
    setEditando(String(fila.id)); setValores(iniciales); setError(null); setAbierto(true);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(null);
    try {
      const cuerpo = aCuerpo(def, valores);
      if (editando) await api.actualizar(`${def.ruta}/${editando}`, cuerpo);
      else await api.crear(def.ruta, cuerpo);
      setAbierto(false);
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function darDeBaja(fila: Fila) {
    const nombre = String(fila[def.columnas[0].nombre] ?? fila.id);
    if (!window.confirm(`¿Dar de baja ${def.singular} «${nombre}»?`)) return;
    try {
      await api.desactivar(`${def.ruta}/${fila.id}`);
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo dar de baja');
    }
  }

  return (
    <section className={estilos.panel}>
      <div className={estilos.barra}>
        <h1 className={estilos.titulo}>{def.titulo}</h1>
        <Button icono="mas" onClick={abrirAlta}>Nuevo {def.singular}</Button>
      </div>

      <div className={estilos.cuerpo}>
        {abierto && (
          <form className={estilos.formulario} onSubmit={guardar}>
            {def.campos.map(campo => (
              <Campo
                key={campo.nombre}
                etiqueta={campo.etiqueta}
                tipo={campo.tipo === 'number' ? 'number' : campo.tipo ?? 'text'}
                requerido={campo.requerido}
                ayuda={campo.ayuda}
                valor={valores[campo.nombre] ?? ''}
                onCambio={v => setValores(p => ({ ...p, [campo.nombre]: v }))}
                deshabilitado={Boolean(editando && campo.soloAlta)}
                opciones={
                  campo.opciones ??
                  (campo.referencia
                    ? (referencias[campo.nombre] ?? []).map(r => ({
                        valor: String(r.id),
                        etiqueta: String(r[campo.referencia!.etiquetaCampo]),
                      }))
                    : undefined)
                }
              />
            ))}
            {error && <p className={estilos.aviso}>{error}</p>}
            <div className={estilos.pieFormulario}>
              <Button variante="secundario" onClick={() => setAbierto(false)}>Cancelar</Button>
              <Button tipo="submit" cargando={guardando}>
                {editando ? 'Guardar cambios' : `Crear ${def.singular}`}
              </Button>
            </div>
          </form>
        )}

        {!abierto && error && <p className={estilos.aviso}>{error}</p>}

        {/* Esqueletos, no spinner: el spec pide bloques por panel. */}
        {filas === null ? (
          <>{[0, 1, 2, 3].map(i => <div key={i} className={estilos.esqueleto} />)}</>
        ) : filas.length === 0 ? (
          <p className={estilos.vacio}>Todavía no hay {def.titulo.toLowerCase()}.</p>
        ) : (
          <table className={estilos.tabla}>
            <thead>
              <tr>
                {def.columnas.map(c => <th key={c.nombre} scope="col">{c.etiqueta}</th>)}
                <th scope="col"><span className="solo-lectores">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map(fila => (
                <tr key={String(fila.id)}>
                  {def.columnas.map(c => (
                    <td key={c.nombre} className={estilos.numerico}>
                      {fila[c.nombre] === null || fila[c.nombre] === undefined
                        ? '—'
                        : String(fila[c.nombre]).slice(0, 40)}
                    </td>
                  ))}
                  <td>
                    <div className={estilos.acciones}>
                      <Button variante="secundario" onClick={() => abrirEdicion(fila)}>
                        Editar
                        <span className="solo-lectores">
                          {' '}{String(fila[def.columnas[0].nombre] ?? '')}
                        </span>
                      </Button>
                      <Button variante="secundario" onClick={() => void darDeBaja(fila)}>
                        Dar de baja
                        <span className="solo-lectores">
                          {' '}{String(fila[def.columnas[0].nombre] ?? '')}
                        </span>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
