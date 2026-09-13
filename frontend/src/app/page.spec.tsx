import { redirect } from 'next/navigation';
import Inicio from './page';

jest.mock('next/navigation', () => ({ redirect: jest.fn() }));

/*
 * La raíz del dominio: lo que ve quien teclea `fleetfuel.jop.lat` a secas.
 *
 * POR QUÉ ESTA PRUEBA EXISTE
 *
 * Hasta el 2026-09-12 la raíz redirigía a `/tablero`, que es el BOCETO de UX-2:
 * seis envíos inventados, sin `ShellApp` —o sea, sin puerta de sesión— y con un
 * menú de botones sin `href`. Un callejón sin salida con datos falsos, servido
 * en producción a cualquiera que llegara sin enlace.
 *
 * No lo vio ninguna de las 293 pruebas del frontend, porque `Tablero.spec.tsx`
 * prueba la maqueta y pasa; y no lo vio ninguno de los tres recorridos de
 * navegador, porque los tres hacen `goto('/entrar')` directo. **La ruta que
 * nadie prueba es la que todo el mundo escribe en la barra.**
 */
describe('la raíz del dominio', () => {
  it('lleva a la aplicación, y la aplicación ya exige sesión', () => {
    /* `/operacion/ordenes` y no `/tablero`: está dentro de `ShellApp`, así que
       quien no ha entrado acaba en `/entrar` por el camino que ya existe, en
       vez de necesitar una segunda puerta que mantener sincronizada. Y es el
       mismo destino al que manda el login: una sola primera pantalla. */
    Inicio();
    expect(redirect).toHaveBeenCalledWith('/operacion/ordenes');
  });

  it('NUNCA a la maqueta', () => {
    Inicio();
    expect(redirect).not.toHaveBeenCalledWith('/tablero');
  });
});
