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
 * §5 · Las personas que pueden entrar al sistema.
 *
 * POR QUÉ NO ES UN `Catalogo` MÁS
 *
 * El componente genérico da de baja con DELETE y edita con PATCH de campos
 * sueltos. Aquí las dos operaciones son otra cosa: los roles son una lista, y
 * la baja no es una baja sino una SUSPENSIÓN que el §21 exige motivar. Forzar
 * las dos dentro del genérico habría hecho el genérico peor para los seis
 * catálogos que sí encajan.
 *
 * LO QUE ESTA PANTALLA AÑADE SOBRE LA API
 *
 * Hacer VISIBLE quién no tiene segundo factor. La API devuelve `mfaHabilitado`
 * y nada obliga a mirarlo; en un sistema cuyo riesgo principal es el fraude
 * interno, una cuenta de administración sin MFA es el agujero, no un detalle de
 * configuración. Va en palabras y no en un color: quien audita necesita poder
 * buscar el texto.
 */

const mensaje = (e: unknown, porDefecto: string) =>
  e instanceof ErrorApi ? e.message : porDefecto;

export function Usuarios() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [roles, setRoles] = useState<Fila[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [alta, setAlta] = useState(false);
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [telefono, setTelefono] = useState('');
  const [rolesElegidos, setRolesElegidos] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);

  /* Quién se está suspendiendo y por qué. El motivo no es un `window.confirm`:
     el §21 pide el motivo del cambio, y un confirm no puede recogerlo. */
  const [suspendiendo, setSuspendiendo] = useState<Fila | null>(null);
  const [motivo, setMotivo] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [us, rs] = await Promise.all([
        api.listar<Fila>('/usuarios'),
        api.listar<Fila>('/roles').catch(() => [] as Fila[]),
      ]);
      setFilas(us); setRoles(rs); setError(null);
    } catch (e) {
      setError(mensaje(e, 'No se pudo cargar la lista de usuarios'));
      setFilas([]);
    }
  }, []);
  useCargaInicial(cargar);

  function abrirAlta() {
    setNombre(''); setCorreo(''); setClave(''); setTelefono('');
    setRolesElegidos([]); setError(null); setAlta(true);
  }

  const alternarRol = (nombreRol: string) =>
    setRolesElegidos(p =>
      p.includes(nombreRol) ? p.filter(r => r !== nombreRol) : [...p, nombreRol]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(null);
    try {
      /* Los opcionales se omiten en vez de mandarse vacíos: `roles: []` y
         «sin roles» dan el mismo resultado, pero el primero afirma una decisión
         que nadie tomó — y un `telefono: ''` choca contra el `@Length(6, 40)`
         del DTO por un campo que la persona ni tocó. */
      await api.crear('/usuarios', {
        nombre, correo, clave,
        ...(telefono ? { telefono } : {}),
        ...(rolesElegidos.length ? { roles: rolesElegidos } : {}),
      });
      setAlta(false);
      await cargar();
    } catch (err) {
      setError(mensaje(err, 'No se pudo crear el usuario'));
    } finally {
      setGuardando(false);
    }
  }

  async function suspender(e: React.FormEvent) {
    e.preventDefault();
    if (!suspendiendo) return;
    /* Se comprueba AQUÍ y no se deja que lo rechace el servidor: mandar la
       petición para recibir un 400 convierte un requisito de auditoría en un
       error de formulario, y así es como se lee — un estorbo, no una razón. */
    if (motivo.trim().length < 10) {
      setError('Explica el motivo de la suspensión (mínimo 10 caracteres). Queda auditado.');
      return;
    }
    setGuardando(true); setError(null);
    try {
      await api.actualizar(`/usuarios/${suspendiendo.id}/suspender`, { motivo: motivo.trim() });
      setSuspendiendo(null); setMotivo('');
      await cargar();
    } catch (err) {
      setError(mensaje(err, 'No se pudo suspender'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className={catalogo.panel}>
      <div className={catalogo.barra}>
        <h1 className={catalogo.titulo}>Usuarios</h1>
        <Button icono="mas" onClick={abrirAlta}>Nuevo usuario</Button>
      </div>

      <div className={catalogo.cuerpo}>
        {alta && (
          <form className={catalogo.formulario} onSubmit={crear}>
            <Campo etiqueta="Nombre" valor={nombre} onCambio={setNombre} requerido />
            <Campo etiqueta="Correo" tipo="email" valor={correo} onCambio={setCorreo} requerido />
            <Campo etiqueta="Clave" tipo="password" valor={clave} onCambio={setClave} requerido
                   autoComplete="new-password"
                   ayuda="Al menos 12 caracteres, con mayúscula, minúscula y un dígito." />
            <Campo etiqueta="Teléfono" tipo="tel" valor={telefono} onCambio={setTelefono} />

            {/* Casillas y no un select múltiple: un `<select multiple>` esconde
                las opciones no visibles y exige Ctrl+clic para desmarcar, que es
                de las interacciones que más gente desconoce. */}
            <fieldset className={estilos.grupo}>
              <legend className={estilos.leyenda}>Roles</legend>
              {roles.length === 0 && <p className={estilos.nota}>No hay roles que asignar.</p>}
              {roles.map(r => (
                <label key={String(r.id)} className={estilos.casilla}>
                  <input type="checkbox"
                         checked={rolesElegidos.includes(String(r.nombre))}
                         onChange={() => alternarRol(String(r.nombre))} />
                  {String(r.nombre)}
                </label>
              ))}
            </fieldset>

            {error && <p className={catalogo.aviso}>{error}</p>}
            <div className={catalogo.pieFormulario}>
              <Button variante="secundario" onClick={() => setAlta(false)}>Cancelar</Button>
              <Button tipo="submit" cargando={guardando}>Crear usuario</Button>
            </div>
          </form>
        )}

        {suspendiendo && (
          <form className={catalogo.formulario} onSubmit={suspender}>
            <h2 className={estilos.subtitulo}>
              Suspender a {String(suspendiendo.nombre)}
            </h2>
            <Campo etiqueta="Motivo" valor={motivo} onCambio={setMotivo} requerido
                   ayuda="Queda registrado en la auditoría junto a quién lo hizo y cuándo." />
            {error && <p className={catalogo.aviso}>{error}</p>}
            <div className={catalogo.pieFormulario}>
              <Button variante="secundario"
                      onClick={() => { setSuspendiendo(null); setError(null); }}>
                Cancelar
              </Button>
              <Button tipo="submit" cargando={guardando}>Confirmar suspensión</Button>
            </div>
          </form>
        )}

        {!alta && !suspendiendo && error && <p className={catalogo.aviso}>{error}</p>}

        {filas === null ? (
          <>{[0, 1, 2, 3].map(i => <div key={i} className={catalogo.esqueleto} />)}</>
        ) : filas.length === 0 ? (
          <p className={catalogo.vacio}>Todavía no hay usuarios.</p>
        ) : (
          <TablaDesplazable etiqueta="Usuarios">
          <table className={catalogo.tabla}>
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">Correo</th>
                <th scope="col">Roles</th>
                <th scope="col">Segundo factor</th>
                <th scope="col">Último acceso</th>
                <th scope="col">Estado</th>
                <th scope="col"><span className="solo-lectores">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => {
                const roles = Array.isArray(f.roles) ? (f.roles as string[]) : [];
                return (
                  <tr key={String(f.id)}>
                    <td>{String(f.nombre)}</td>
                    <td>{String(f.correo)}</td>
                    <td>{roles.length ? roles.join(', ') : '—'}</td>
                    <td className={f.mfaHabilitado ? undefined : estilos.riesgo}>
                      {f.mfaHabilitado ? 'Con MFA' : 'Sin MFA'}
                    </td>
                    {/* «Nunca» y no una celda vacía: un hueco se lee como un
                        dato que falta por un fallo, no como una cuenta que no
                        se ha usado jamás — que es justo la que hay que mirar. */}
                    <td>{f.ultimoAccesoEn ? String(f.ultimoAccesoEn).slice(0, 10) : 'Nunca'}</td>
                    <td>{String(f.estado)}</td>
                    <td>
                      <div className={catalogo.acciones}>
                        {f.estado !== 'suspendido' && (
                          <Button variante="secundario"
                                  onClick={() => { setSuspendiendo(f); setMotivo(''); setError(null); }}>
                            {/* «a Ana Pérez» y no «Ana Pérez»: fuera de la
                                fila, diez botones llamados «Suspender» son
                                indistinguibles. Y con la preposición el texto
                                oculto deja de ser idéntico al de la celda, que
                                convertía cada nombre en dos coincidencias. */}
                            Suspender
                            <span className="solo-lectores"> a {String(f.nombre)}</span>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </TablaDesplazable>
        )}
      </div>
    </section>
  );
}
