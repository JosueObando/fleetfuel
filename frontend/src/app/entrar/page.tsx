'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Campo } from '@/componentes/Campo/Campo';
import { Button } from '@/componentes/Button/Button';
import { Icon } from '@/componentes/Icon/Icon';
import { entrar, guardarSesion, iniciarMfa, confirmarMfa, ErrorApi } from '@/api/cliente';
import estilos from './entrar.module.css';

export default function Entrar() {
  const router = useRouter();
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  /* La inscripción del segundo factor vive EN MEMORIA y nunca en
     `localStorage`. El token que la autoriza no es una sesión: viene sin
     `refreshToken` y con cero permisos, y sólo sirve para los dos endpoints de
     MFA. Guardarlo con `guardarSesion` habría abierto la aplicación entera a un
     token que responde 403 a todo — la persona vería el menú, pulsaría Órdenes
     y recibiría un error sin relación aparente con lo que le pasa. */
  const [inscripcion, setInscripcion] =
    useState<{ token: string; secreto: string; otpauth: string } | null>(null);
  const [codigoNuevo, setCodigoNuevo] = useState('');

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setAviso(null); setEnviando(true);
    try {
      const sesion = await entrar(correo, clave, totp || undefined);

      /* §7: mientras el MFA no esté inscrito, el token que devuelve el login
         no sirve para nada más que inscribirlo —viene con cero permisos—. Se
         detecta aquí para no dejar entrar a una aplicación que responderá 403
         a todo. */
      if (sesion.debeInscribirMfa) {
        const { secreto, otpauth } = await iniciarMfa(sesion.accessToken);
        setInscripcion({ token: sesion.accessToken, secreto, otpauth });
        return;
      }
      guardarSesion(sesion);
      router.push('/operacion/ordenes');
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo conectar con el servidor');
    } finally {
      setEnviando(false);
    }
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!inscripcion) return;
    setError(null); setEnviando(true);
    try {
      await confirmarMfa(inscripcion.token, codigoNuevo);
      /* De vuelta al formulario, y NO se entra sola: habilitar el MFA no le
         añade ni un permiso al token de inscripción. Ahora el código de
         verificación del formulario ya existe, que es lo que faltaba. */
      setInscripcion(null);
      setCodigoNuevo('');
      setClave('');
      setAviso('Segundo factor inscrito. Ya puedes entrar con tu contraseña y '
             + 'el código de la aplicación.');
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo confirmar el código');
    } finally {
      setEnviando(false);
    }
  }

  /* En grupos de cuatro. Un secreto TOTP son 32 caracteres sin separación
     alguna: quien lo teclea a mano pierde el sitio a la mitad, y el error se
     descubre seis dígitos después, cuando la aplicación da un código que no
     vale. */
  const enGrupos = (s: string) => (s.match(/.{1,4}/g) ?? []).join(' ');

  return (
    <main className={estilos.pantalla}>
      <div className={estilos.tarjeta}>
        <div className={estilos.marca}>
          <span className={estilos.circulo}><Icon nombre="flota" tamano={20} /></span>
          <div>
            <div className={estilos.titulo}>FleetFuel</div>
            <div className={estilos.subtitulo}>Control de flota y combustible</div>
          </div>
        </div>

        {inscripcion ? (
          <form className={estilos.formulario} onSubmit={confirmar}>
            <h1 className={estilos.tituloPaso}>Inscribe tu segundo factor</h1>
            <p className={estilos.explicacion}>
              Esta cuenta todavía no tiene segundo factor, y sin él no se puede
              usar el sistema. Añade este secreto a tu aplicación de
              autenticación y confirma con el código que te dé.
            </p>

            <code className={estilos.secreto}>{enGrupos(inscripcion.secreto)}</code>

            {/* Desde el móvil, tocarlo lo abre directamente en la aplicación de
                autenticación; desde el escritorio no hará nada y por eso el
                secreto está también en claro, arriba. */}
            <a className={estilos.enlace} href={inscripcion.otpauth}>
              Abrir en la aplicación de autenticación
            </a>

            <Campo etiqueta="Código de 6 dígitos" valor={codigoNuevo} onCambio={setCodigoNuevo}
                   requerido autoComplete="one-time-code" marcador="000000"
                   ayuda="El que muestra la aplicación en este momento." />

            {error && <p className={estilos.aviso}>{error}</p>}

            <div className={estilos.acciones}>
              <Button tipo="submit" cargando={enviando}>Confirmar</Button>
            </div>
          </form>
        ) : (
        <form className={estilos.formulario} onSubmit={enviar}>
          <Campo etiqueta="Correo" tipo="email" valor={correo} onCambio={setCorreo}
                 requerido autoComplete="username" marcador="tu@correo" />
          <Campo etiqueta="Contraseña" tipo="password" valor={clave} onCambio={setClave}
                 requerido autoComplete="current-password" />
          <Campo etiqueta="Código de verificación" valor={totp} onCambio={setTotp}
                 autoComplete="one-time-code" marcador="6 dígitos"
                 ayuda="El de tu aplicación de autenticación." />

          {error && <p className={estilos.aviso}>{error}</p>}
          {aviso && <p className={`${estilos.aviso} ${estilos.info}`}>{aviso}</p>}

          <div className={estilos.acciones}>
            {/* submit de verdad: así el Enter desde cualquier campo envía el
                formulario, que es como la gente rellena un login. */}
            <Button tipo="submit" cargando={enviando}>Entrar</Button>
          </div>
        </form>
        )}
      </div>
    </main>
  );
}
