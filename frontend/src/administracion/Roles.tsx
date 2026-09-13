'use client';

import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/componentes/Button/Button';
import { Campo } from '@/componentes/Campo/Campo';
import { api, ErrorApi } from '@/api/cliente';
import { useCargaInicial } from '@/api/carga';
import type { Fila } from '@/api/tipos';
import catalogo from '@/catalogos/Catalogo.module.css';
import estilos from './administracion.module.css';

/**
 * §5 · Los roles y lo que cada uno puede hacer.
 *
 * POR QUÉ EXISTE, QUE NO ES «PORQUE FALTABA»
 *
 * Producción estuvo días con un «Administrador» de 11 permisos sobre 48 que no
 * podía leer un cliente. La causa fue una migración que reparte permisos
 * buscando el rol por nombre y no falla al no encontrarlo; el motivo de que
 * durara días fue que NO HABÍA DÓNDE VERLO — las comprobaciones iban por
 * `/api/salud` y `/auth/login`, que no tocan permisos.
 *
 * De ahí el recuento «11 de 48» junto a cada rol. Es la cifra que delata un
 * reparto a medio aplicar sin que nadie vaya a buscarlo, y por eso tiene prueba
 * propia en vez de ser un adorno de la lista.
 */

const mensaje = (e: unknown, porDefecto: string) =>
  e instanceof ErrorApi ? e.message : porDefecto;

export function Roles() {
  const [roles, setRoles] = useState<Fila[] | null>(null);
  const [permisos, setPermisos] = useState<Fila[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  /* Se guarda el ID del rol abierto, no el objeto: así lo que se pinta sale
     SIEMPRE de la lista recién cargada, y una recarga no deja el panel
     enseñando los permisos de antes de guardar. */
  const [abiertoId, setAbiertoId] = useState<string | null>(null);
  /* `null` significa «sin tocar»: las casillas se derivan del rol. En cuanto
     alguien marca una, pasa a mandar esta lista. Es lo que impide que al
     cambiar de rol se arrastren las casillas del anterior — el mismo fallo que
     ya apareció en viajes y en informes, cerrado aquí por construcción. */
  const [marcados, setMarcados] = useState<string[] | null>(null);

  const [alta, setAlta] = useState(false);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [exigeMfa, setExigeMfa] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [rs, ps] = await Promise.all([
        api.listar<Fila>('/roles'),
        api.listar<Fila>('/permisos'),
      ]);
      setRoles(rs); setPermisos(ps); setError(null);
    } catch (e) {
      setError(mensaje(e, 'No se pudo cargar los roles'));
      setRoles([]);
    }
  }, []);
  useCargaInicial(cargar);

  const abierto = roles?.find(r => String(r.id) === abiertoId) ?? null;
  const delRol = useMemo(
    () => (Array.isArray(abierto?.permisos) ? (abierto.permisos as string[]) : []),
    [abierto]);
  const seleccion = marcados ?? delRol;

  /* Por módulo. Cuarenta y ocho casillas seguidas no se leen: se buscan una a
     una, y quien busca «el de autorizar» acaba marcando el que se le parece. */
  const porModulo = useMemo(() => {
    const mapa = new Map<string, Fila[]>();
    for (const p of permisos) {
      const m = String(p.modulo);
      mapa.set(m, [...(mapa.get(m) ?? []), p]);
    }
    return [...mapa.entries()];
  }, [permisos]);

  function abrir(rol: Fila) {
    setAbiertoId(String(rol.id));
    setMarcados(null);   // vuelve a derivarse del rol recién abierto
    setAlta(false);
    setError(null);
  }

  const alternar = (codigo: string) =>
    setMarcados(prev => {
      const base = prev ?? delRol;
      return base.includes(codigo) ? base.filter(c => c !== codigo) : [...base, codigo];
    });

  async function guardarPermisos() {
    if (!abierto) return;
    setGuardando(true); setError(null);
    try {
      /* El conjunto ENTERO. Es un PUT: lo que no va en la lista se pierde, así
         que mandar sólo lo que cambió dejaría al rol con ese único permiso —
         exactamente la forma del incidente, esta vez provocada desde aquí. */
      await api.reemplazar(`/roles/${abierto.id}/permisos`, { permisos: seleccion });
      setMarcados(null);
      await cargar();
    } catch (err) {
      setError(mensaje(err, 'No se pudieron guardar los permisos'));
    } finally {
      setGuardando(false);
    }
  }

  async function crearRol(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(null);
    try {
      await api.crear('/roles', { nombre, descripcion, exigeMfa });
      setAlta(false); setNombre(''); setDescripcion(''); setExigeMfa(false);
      await cargar();
    } catch (err) {
      setError(mensaje(err, 'No se pudo crear el rol'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className={catalogo.panel}>
      <div className={catalogo.barra}>
        <h1 className={catalogo.titulo}>Roles y permisos</h1>
        <Button icono="mas" onClick={() => { setAlta(true); setAbiertoId(null); setError(null); }}>
          Nuevo rol
        </Button>
      </div>

      <div className={catalogo.cuerpo}>
        {alta && (
          <form className={catalogo.formulario} onSubmit={crearRol}>
            <Campo etiqueta="Nombre" valor={nombre} onCambio={setNombre} requerido />
            <Campo etiqueta="Descripción" valor={descripcion} onCambio={setDescripcion} />
            <label className={estilos.casilla}>
              <input type="checkbox" checked={exigeMfa} onChange={() => setExigeMfa(v => !v)} />
              Exige segundo factor
            </label>
            {/* Crear el rol es la mitad del trabajo; la otra mitad es la que se
                olvidó en el incidente del Administrador. */}
            <p className={estilos.nota}>
              Un rol nuevo nace <strong>sin permisos</strong>: ábrelo en la lista
              y márcaselos antes de asignárselo a nadie.
            </p>
            {error && <p className={catalogo.aviso}>{error}</p>}
            <div className={catalogo.pieFormulario}>
              <Button variante="secundario" onClick={() => setAlta(false)}>Cancelar</Button>
              <Button tipo="submit" cargando={guardando}>Crear rol</Button>
            </div>
          </form>
        )}

        {!alta && error && <p className={catalogo.aviso}>{error}</p>}

        {roles === null ? (
          <>{[0, 1, 2].map(i => <div key={i} className={catalogo.esqueleto} />)}</>
        ) : roles.length === 0 ? (
          <p className={catalogo.vacio}>Todavía no hay roles.</p>
        ) : (
          <div className={estilos.listaRoles}>
            {roles.map(r => {
              const suyos = Array.isArray(r.permisos) ? (r.permisos as string[]) : [];
              return (
                <button key={String(r.id)} type="button"
                        className={estilos.tarjetaRol}
                        aria-expanded={String(r.id) === abiertoId}
                        onClick={() => abrir(r)}>
                  <span className={estilos.nombreRol}>{String(r.nombre)}</span>
                  {/* La cifra del incidente. */}
                  <span className={estilos.recuento}>
                    {suyos.length} de {permisos.length} permisos
                  </span>
                  {r.exigeMfa ? <span className={estilos.etiquetaMfa}>MFA</span> : null}
                  <span className={estilos.descripcionRol}>
                    {r.descripcion ? String(r.descripcion) : '—'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {abierto && (
          <div className={estilos.editorPermisos}>
            <h2 className={estilos.subtitulo}>Permisos de {String(abierto.nombre)}</h2>

            {porModulo.map(([modulo, lista]) => (
              <fieldset key={modulo} className={`${estilos.grupo} ${estilos.modulo}`}>
                <legend className={estilos.leyenda}>{modulo}</legend>
                <div className={estilos.rejillaPermisos}>
                  {lista.map(p => (
                    <label key={String(p.codigo)} className={estilos.casilla}>
                      <input type="checkbox"
                             checked={seleccion.includes(String(p.codigo))}
                             onChange={() => alternar(String(p.codigo))} />
                      {String(p.descripcion)}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}

            <div className={catalogo.pieFormulario}>
              <Button variante="secundario" onClick={() => setAbiertoId(null)}>Cerrar</Button>
              <Button cargando={guardando} onClick={() => void guardarPermisos()}>
                Guardar permisos
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
