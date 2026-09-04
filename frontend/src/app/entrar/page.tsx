'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Campo } from '@/componentes/Campo/Campo';
import { Button } from '@/componentes/Button/Button';
import { Icon } from '@/componentes/Icon/Icon';
import { entrar, guardarSesion, ErrorApi } from '@/api/cliente';
import estilos from './entrar.module.css';

export default function Entrar() {
  const router = useRouter();
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

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
        setAviso('Esta cuenta aún no tiene el segundo factor inscrito. '
               + 'Hay que completarlo antes de poder usar el sistema.');
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

  return (
    <main className={estilos.pantalla}>
      <div className={estilos.tarjeta}>
        <div className={estilos.marca}>
          <span className={estilos.circulo}><Icon nombre="flota" tamano={20} /></span>
          <div>
            <div className={estilos.titulo}>FleetFuel</div>
            <div className={estilos.subtitulo}>Alcaldía de Panamá</div>
          </div>
        </div>

        <form className={estilos.formulario} onSubmit={enviar}>
          <Campo etiqueta="Correo" tipo="email" valor={correo} onCambio={setCorreo}
                 requerido autoComplete="username" marcador="tu@mupa.gob.pa" />
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
      </div>
    </main>
  );
}
