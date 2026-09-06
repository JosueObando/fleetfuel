import { leerSesion, guardarSesion, api, entrar, ErrorApi, type Sesion } from './cliente';

/*
 * El cliente de API: el único punto por el que el frontend habla con el
 * backend. Hasta ahora el frontend no tenía NINGUNA prueba, y este fichero es
 * donde viven las decisiones que se repiten en todas las pantallas: el token,
 * la clave de idempotencia, y qué hacer con cada código de error.
 *
 * Se prueba con `fetch` sustituido y `localStorage` real (el de jsdom), no al
 * revés: lo que interesa comprobar es qué PIDE el cliente y qué hace con la
 * respuesta, no que fetch funcione.
 */

const SESION: Sesion = {
  accessToken: 'token-de-prueba',
  refreshToken: 'refresco',
  usuario: { id: '1', nombre: 'Ana', correo: 'ana@ejemplo.test', roles: ['Administrador'] },
};

/** Deja `fetch` devolviendo lo que se le diga y guarda cómo lo llamaron. */
function fingirRespuesta(estado: number, cuerpo: unknown) {
  const espia = jest.fn(async () => ({
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
  }));
  global.fetch = espia as unknown as typeof fetch;
  return espia;
}

const cabecerasDe = (espia: jest.Mock): Headers =>
  (espia.mock.calls[0][1] as RequestInit).headers as Headers;

beforeEach(() => {
  window.localStorage.clear();
  jest.restoreAllMocks();
});

describe('la sesión guardada', () => {
  it('se lee y se escribe', () => {
    guardarSesion(SESION);
    expect(leerSesion()?.accessToken).toBe('token-de-prueba');
  });

  it('un JSON corrupto se trata como «no hay sesión», no revienta', () => {
    // Pasa de verdad: una versión anterior con otro formato, o almacenamiento
    // manipulado. Si esto lanzara, la aplicación no cargaría NUNCA y la única
    // salida sería que el usuario supiera vaciar el almacenamiento del sitio.
    window.localStorage.setItem('fleetfuel.sesion', '{no es json');
    expect(() => leerSesion()).not.toThrow();
    expect(leerSesion()).toBeNull();
  });

  it('sin almacenamiento disponible tampoco revienta', () => {
    // Ventana privada, o el navegador con las cookies de sitio bloqueadas.
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('almacenamiento bloqueado');
    });
    expect(() => guardarSesion(SESION)).not.toThrow();
  });

  it('guardar null la borra', () => {
    guardarSesion(SESION);
    guardarSesion(null);
    expect(leerSesion()).toBeNull();
  });
});

describe('lo que el cliente pone en cada petición', () => {
  it('manda el token cuando hay sesión', async () => {
    guardarSesion(SESION);
    const espia = fingirRespuesta(200, []);
    await api.listar('/clientes');
    expect(cabecerasDe(espia).get('Authorization')).toBe('Bearer token-de-prueba');
  });

  it('NO manda Authorization cuando no hay sesión', async () => {
    const espia = fingirRespuesta(200, []);
    await api.listar('/clientes');
    expect(cabecerasDe(espia).get('Authorization')).toBeNull();
  });

  it('pone Idempotency-Key en los POST', async () => {
    // ADR 004: sin ella el backend responde 422. Que se genere aquí y no en
    // cada pantalla es lo que evita que una pantalla se olvide.
    const espia = fingirRespuesta(201, { id: '1' });
    await api.crear('/clientes', { nombre: 'X' });
    const clave = cabecerasDe(espia).get('Idempotency-Key');
    expect(clave).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('cada POST lleva una clave DISTINTA', async () => {
    // Reutilizarla haría que la segunda alta devolviera la respuesta de la
    // primera y el usuario creería haber creado dos cosas habiendo creado una.
    const claves = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const espia = fingirRespuesta(201, { id: String(i) });
      await api.crear('/clientes', { nombre: `X${i}` });
      claves.add(cabecerasDe(espia).get('Idempotency-Key') as string);
    }
    expect(claves.size).toBe(3);
  });

  it('NO la pone en GET, PATCH ni DELETE', async () => {
    // Sólo los POST crean. Mandarla en los demás sería ruido que el backend
    // ignora, pero también una invitación a que alguien la empiece a esperar.
    for (const llamada of [
      () => api.listar('/clientes'),
      () => api.actualizar('/clientes/1', { nombre: 'Y' }),
      () => api.desactivar('/clientes/1'),
    ]) {
      const espia = fingirRespuesta(200, {});
      await llamada();
      expect(cabecerasDe(espia).get('Idempotency-Key')).toBeNull();
    }
  });
});

describe('qué hace con cada error', () => {
  it('un 401 borra la sesión: el token caducó', async () => {
    guardarSesion(SESION);
    fingirRespuesta(401, { message: 'No autorizado' });
    await expect(api.listar('/clientes')).rejects.toBeInstanceOf(ErrorApi);
    expect(leerSesion()).toBeNull();
  });

  it('un 403 NO borra la sesión, y esa diferencia importa', async () => {
    // 403 es «sé quién eres y no puedes». Si también cerrara la sesión, al
    // usuario le echarían de la aplicación por pulsar un botón que no le
    // corresponde, y volver a entrar no arreglaría nada.
    guardarSesion(SESION);
    fingirRespuesta(403, { message: 'Sin permiso' });
    await expect(api.listar('/clientes')).rejects.toThrow('Sin permiso');
    expect(leerSesion()?.accessToken).toBe('token-de-prueba');
  });

  it('junta los mensajes de validación de Nest, que vienen en lista', async () => {
    fingirRespuesta(400, { message: ['El nombre es obligatorio', 'El RUC no es válido'] });
    await expect(api.crear('/clientes', {}))
      .rejects.toThrow('El nombre es obligatorio. El RUC no es válido');
  });

  it('con un cuerpo de error sin mensaje, informa del código', async () => {
    fingirRespuesta(500, null);
    await expect(api.listar('/clientes')).rejects.toThrow('Error 500');
  });

  it('conserva el código en el error, para que la pantalla pueda decidir', async () => {
    fingirRespuesta(422, { message: 'Clave ya usada' });
    const e = await api.crear('/clientes', {}).catch(x => x);
    expect(e.estado).toBe(422);
  });

  it('un 204 no intenta leer cuerpo', async () => {
    // `DELETE` devuelve 204 sin cuerpo: llamar a .json() ahí lanza.
    const espia = jest.fn(async () => ({
      ok: true, status: 204,
      json: async () => { throw new Error('no hay cuerpo que leer'); },
    }));
    global.fetch = espia as unknown as typeof fetch;
    await expect(api.desactivar('/clientes/1')).resolves.toBeUndefined();
  });
});

describe('entrar', () => {
  it('no manda codigoTotp cuando no lo hay', async () => {
    // Mandarlo vacío hace que el backend lo valide contra `^\\d{6}$` y responda
    // 400 en vez de la puerta de MFA, que es un mensaje distinto y confuso.
    const espia = fingirRespuesta(200, SESION);
    await entrar('ana@ejemplo.test', 'clave12345');
    expect(JSON.parse((espia.mock.calls[0][1] as RequestInit).body as string))
      .toEqual({ correo: 'ana@ejemplo.test', clave: 'clave12345' });
  });

  it('lo manda cuando sí lo hay', async () => {
    const espia = fingirRespuesta(200, SESION);
    await entrar('ana@ejemplo.test', 'clave12345', '123456');
    expect(JSON.parse((espia.mock.calls[0][1] as RequestInit).body as string).codigoTotp)
      .toBe('123456');
  });

  it('NO manda el token de una sesión anterior', async () => {
    // Entrar tiene que funcionar aunque haya una sesión caducada guardada.
    guardarSesion(SESION);
    const espia = fingirRespuesta(200, SESION);
    await entrar('ana@ejemplo.test', 'clave12345');
    const cabeceras = (espia.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(cabeceras.Authorization).toBeUndefined();
  });

  it('propaga el 429 del freno con su mensaje', async () => {
    fingirRespuesta(429, { message: 'Demasiados intentos. Espera un momento y vuelve a intentarlo.' });
    const e = await entrar('ana@ejemplo.test', 'mala').catch(x => x);
    expect(e.estado).toBe(429);
    expect(e.message).toMatch(/Demasiados intentos/);
  });
});
