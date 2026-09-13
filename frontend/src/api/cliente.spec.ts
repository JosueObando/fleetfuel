import {
  leerSesion, guardarSesion, api, entrar, ErrorApi, type Sesion,
  iniciarMfa, confirmarMfa, cerrarSesion,
  instantaneaDeSesion, sesionDelServidor, suscribirseASesion,
} from './cliente';

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

/**
 * Deja `fetch` devolviendo lo que se le diga y guarda cómo lo llamaron.
 *
 * Los parámetros se declaran aunque no se usen: sin ellos `mock.calls[0][1]`
 * tiene tipo de tupla vacía y no se puede leer lo que se envió. Y `tsc` sí lo
 * ve aunque las pruebas pasen, porque `next/jest` transpila con SWC —que borra
 * los tipos sin comprobarlos— y el `tsc --noEmit` de CI va aparte.
 */
type EspiaFetch = jest.Mock<Promise<Partial<Response>>, [string, RequestInit?]>;

function fingirRespuesta(estado: number, cuerpo: unknown): EspiaFetch {
  const espia = jest.fn(async (_url: string, _init?: RequestInit) => ({
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
  })) as unknown as EspiaFetch;
  global.fetch = espia as unknown as typeof fetch;
  return espia;
}

const peticionDe = (espia: EspiaFetch): RequestInit => espia.mock.calls[0][1] ?? {};
const cabecerasDe = (espia: EspiaFetch): Headers => peticionDe(espia).headers as Headers;

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

describe('reemplazar (PUT)', () => {
  /*
   * Existe por `PUT /roles/:id/permisos`, que es el único endpoint del sistema
   * que REEMPLAZA una colección entera en vez de modificar campos. Se añadió
   * como verbo propio y no como una opción de `actualizar` porque la diferencia
   * no es de transporte sino de significado: un PATCH que se olvide de un
   * permiso lo deja como estaba; un PUT que se olvide de un permiso lo QUITA.
   */
  it('manda PUT con el cuerpo entero', async () => {
    const espia = fingirRespuesta(200, { ok: true });
    await api.reemplazar('/roles/r1/permisos', { permisos: ['a', 'b'] });
    expect(peticionDe(espia).method).toBe('PUT');
    expect(JSON.parse(String(peticionDe(espia).body))).toEqual({ permisos: ['a', 'b'] });
  });

  it('no lleva Idempotency-Key: un PUT ya es idempotente por definición', async () => {
    // La clave existe para que un reintento de POST no cree dos filas. Repetir
    // este PUT deja exactamente el mismo conjunto de permisos.
    const espia = fingirRespuesta(200, { ok: true });
    await api.reemplazar('/roles/r1/permisos', { permisos: [] });
    expect(cabecerasDe(espia).get('Idempotency-Key')).toBeNull();
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
    const e = (await api.crear('/clientes', {}).catch(x => x)) as ErrorApi;
    expect(e.estado).toBe(422);
  });

  it('un 204 no intenta leer cuerpo', async () => {
    // `DELETE` devuelve 204 sin cuerpo: llamar a .json() ahí lanza.
    const espia = jest.fn(async (_url: string, _init?: RequestInit) => ({
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
    expect(JSON.parse(peticionDe(espia).body as string))
      .toEqual({ correo: 'ana@ejemplo.test', clave: 'clave12345' });
  });

  it('lo manda cuando sí lo hay', async () => {
    const espia = fingirRespuesta(200, SESION);
    await entrar('ana@ejemplo.test', 'clave12345', '123456');
    expect(JSON.parse(peticionDe(espia).body as string).codigoTotp).toBe('123456');
  });

  it('NO manda el token de una sesión anterior', async () => {
    // Entrar tiene que funcionar aunque haya una sesión caducada guardada.
    guardarSesion(SESION);
    const espia = fingirRespuesta(200, SESION);
    await entrar('ana@ejemplo.test', 'clave12345');
    /* Se lee como `Headers`, no como objeto plano: desde que la puerta usa
       `new Headers(...)` —2026-09-12, al añadir la inscripción de MFA— un
       `cabeceras.Authorization` daría `undefined` SIEMPRE, y esta prueba
       pasaría sin comprobar nada. La afirmación de al lado, sobre
       `Content-Type`, es la que fija que la lectura sí ve lo que se manda. */
    expect(cabecerasDe(espia).get('Authorization')).toBeNull();
    expect(cabecerasDe(espia).get('Content-Type')).toBe('application/json');
  });

  it('propaga el 429 del freno con su mensaje', async () => {
    fingirRespuesta(429, { message: 'Demasiados intentos. Espera un momento y vuelve a intentarlo.' });
    const e = (await entrar('ana@ejemplo.test', 'mala').catch(x => x)) as ErrorApi;
    expect(e.estado).toBe(429);
    expect(e.message).toMatch(/Demasiados intentos/);
  });
});

/*
 * La sesión como almacén externo, que es lo que `ShellApp` lee con
 * `useSyncExternalStore`.
 *
 * Se prueba aparte de `leerSesion` porque tiene un contrato distinto y más
 * exigente: la instantánea debe devolver la MISMA REFERENCIA mientras el
 * contenido no cambie. Si devolviera un objeto nuevo en cada llamada, React
 * creería que el almacén cambió en cada render y entraría en un bucle — y el
 * síntoma sería la pantalla congelada, no un error.
 */
describe('la sesión como almacén externo', () => {
  it('devuelve la misma referencia mientras el almacén no cambia', () => {
    guardarSesion(SESION);
    const primera = instantaneaDeSesion();
    const segunda = instantaneaDeSesion();
    expect(primera).not.toBeNull();
    expect(segunda).toBe(primera);
  });

  it('devuelve una referencia NUEVA cuando la sesión cambia', () => {
    guardarSesion(SESION);
    const antes = instantaneaDeSesion();
    guardarSesion({ ...SESION, accessToken: 'otro-token' });
    const despues = instantaneaDeSesion();
    expect(despues).not.toBe(antes);
    expect(despues?.accessToken).toBe('otro-token');
  });

  it('sin sesión es nula, y sigue siéndolo al releer', () => {
    guardarSesion(null);
    expect(instantaneaDeSesion()).toBeNull();
    expect(instantaneaDeSesion()).toBeNull();
  });

  it('un JSON corrupto se lee como «no hay sesión»', () => {
    window.localStorage.setItem('fleetfuel.sesion', '{no es json');
    expect(instantaneaDeSesion()).toBeNull();
  });

  it('sin almacenamiento disponible tampoco revienta', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('almacenamiento bloqueado');
    });
    expect(() => instantaneaDeSesion()).not.toThrow();
    expect(instantaneaDeSesion()).toBeNull();
  });

  it('en el servidor no hay sesión, y eso evita el desajuste de hidratación', () => {
    expect(sesionDelServidor()).toBeNull();
  });

  it('avisa a quien esté suscrito cuando la sesión cambia', () => {
    const avisado = jest.fn();
    const desuscribir = suscribirseASesion(avisado);
    guardarSesion(SESION);
    expect(avisado).toHaveBeenCalledTimes(1);
    guardarSesion(null);
    expect(avisado).toHaveBeenCalledTimes(2);
    desuscribir();
  });

  it('deja de avisar tras desuscribirse', () => {
    // Sin esto, un componente desmontado seguiría pidiendo renders y React
    // avisaría de una fuga en cada cierre de sesión.
    const avisado = jest.fn();
    suscribirseASesion(avisado)();
    guardarSesion(SESION);
    expect(avisado).not.toHaveBeenCalled();
  });

  it('un cierre de sesión en OTRA pestaña también avisa, y refresca la lectura', () => {
    // Es el caso que `guardarSesion` no puede cubrir por su cuenta: el cambio
    // lo hizo otro documento, así que la única señal es el evento `storage`.
    guardarSesion(SESION);
    expect(instantaneaDeSesion()).not.toBeNull();

    const avisado = jest.fn();
    const desuscribir = suscribirseASesion(avisado);

    window.localStorage.removeItem('fleetfuel.sesion');
    window.dispatchEvent(new StorageEvent('storage', { key: 'fleetfuel.sesion' }));

    expect(avisado).toHaveBeenCalled();
    expect(instantaneaDeSesion()).toBeNull();
    desuscribir();
  });
});

describe('inscribir el segundo factor', () => {
  /*
   * El token que devuelve un login con el MFA sin inscribir NO ES UNA SESIÓN:
   * viene sin `refreshToken` y con cero permisos, y sólo sirve para llamar a
   * estos dos endpoints. Por eso estas dos funciones reciben el token POR
   * PARÁMETRO en vez de leerlo del almacén, igual que `entrar`.
   *
   * Guardarlo con `guardarSesion` habría sido más corto y habría abierto la
   * aplicación entera a un token que responde 403 a todo: la persona vería el
   * menú, pulsaría Órdenes y recibiría un error sin relación aparente con lo
   * que le pasa de verdad.
   */
  it('iniciar manda el token de inscripción, no el de la sesión guardada', async () => {
    guardarSesion(SESION);
    const espia = fingirRespuesta(200, { secreto: 'ABCD', otpauth: 'otpauth://x' });
    await iniciarMfa('token-de-inscripcion');
    expect(cabecerasDe(espia).get('Authorization')).toBe('Bearer token-de-inscripcion');
  });

  it('y devuelve el secreto con su otpauth', async () => {
    fingirRespuesta(200, { secreto: 'ABCD', otpauth: 'otpauth://totp/x' });
    await expect(iniciarMfa('t')).resolves.toEqual(
      expect.objectContaining({ secreto: 'ABCD', otpauth: 'otpauth://totp/x' }));
  });

  it('confirmar manda el código en el cuerpo', async () => {
    const espia = fingirRespuesta(200, { mfaHabilitado: true });
    await confirmarMfa('t', '123456');
    expect(JSON.parse(String(peticionDe(espia).body))).toEqual({ codigoTotp: '123456' });
  });

  it('un código malo llega como ErrorApi con el mensaje del servidor', async () => {
    // El backend distingue «código incorrecto» de «revisa la hora del
    // dispositivo», que es la causa real la mitad de las veces. Perder ese
    // matiz obligaría a la persona a adivinar.
    fingirRespuesta(400, { message: 'Código incorrecto. Revisa la hora del dispositivo.' });
    await expect(confirmarMfa('t', '000000')).rejects.toThrow(/Revisa la hora/);
  });

  it('un 401 aquí NO borra una sesión ajena', async () => {
    /* `pedir` borra la sesión ante un 401 porque asume que el token caducado es
       EL de la sesión. Aquí el token es otro —vive en memoria, en la pantalla
       de entrada— así que borrar la sesión guardada sería echar de la
       aplicación a una pestaña que estaba trabajando sin problema. */
    guardarSesion(SESION);
    fingirRespuesta(401, { message: 'Token inválido' });
    await expect(iniciarMfa('caducado')).rejects.toThrow(ErrorApi);
    expect(leerSesion()).not.toBeNull();
  });
});

/*
 * ── El refresco del token ──────────────────────────────────────────────────
 *
 * El access token vive 15 minutos. Hasta el 2026-09-12 el cliente guardaba el
 * `refreshToken` y NO LO USABA NUNCA: a los 15 minutos el primer 401 borraba la
 * sesión y echaba a la persona a `/entrar`, a media pantalla de despacho. El
 * endpoint `/auth/refrescar` existía desde la Fase 0.3.
 */
function encolarRespuestas(...respuestas: Array<{ estado: number; cuerpo: unknown }>): EspiaFetch {
  const espia = jest.fn(async (_url: string, _init?: RequestInit) => {
    const r = respuestas.shift() ?? { estado: 500, cuerpo: { message: 'sin respuesta encolada' } };
    return {
      ok: r.estado >= 200 && r.estado < 300,
      status: r.estado,
      json: async () => r.cuerpo,
    };
  }) as unknown as EspiaFetch;
  global.fetch = espia as unknown as typeof fetch;
  return espia;
}
const rutasPedidas = (espia: EspiaFetch) => espia.mock.calls.map(c => String(c[0]));

describe('el token caducado se refresca en vez de echar a la calle', () => {
  const SESION_NUEVA = { ...SESION, accessToken: 'token-nuevo', refreshToken: 'refresco-nuevo' };

  it('ante un 401, refresca y REINTENTA la petición', async () => {
    guardarSesion(SESION);
    const espia = encolarRespuestas(
      { estado: 401, cuerpo: { message: 'Token vencido' } },
      { estado: 200, cuerpo: SESION_NUEVA },
      { estado: 200, cuerpo: [{ id: 1 }] },
    );

    await expect(api.listar('/viajes')).resolves.toEqual([{ id: 1 }]);
    expect(rutasPedidas(espia)[1]).toContain('/auth/refrescar');
    expect(rutasPedidas(espia)[2]).toContain('/viajes');
  });

  it('el reintento va con el token NUEVO, no con el caducado', async () => {
    guardarSesion(SESION);
    const espia = encolarRespuestas(
      { estado: 401, cuerpo: {} },
      { estado: 200, cuerpo: SESION_NUEVA },
      { estado: 200, cuerpo: [] },
    );
    await api.listar('/viajes');
    const cabeceras = espia.mock.calls[2][1]?.headers as Headers;
    expect(cabeceras.get('Authorization')).toBe('Bearer token-nuevo');
  });

  it('y la sesión refrescada queda guardada', async () => {
    guardarSesion(SESION);
    encolarRespuestas(
      { estado: 401, cuerpo: {} },
      { estado: 200, cuerpo: SESION_NUEVA },
      { estado: 200, cuerpo: [] },
    );
    await api.listar('/viajes');
    expect(leerSesion()?.accessToken).toBe('token-nuevo');
  });

  it('un POST reintentado conserva SU MISMA clave de idempotencia', async () => {
    /* Generar una clave nueva convertiría el reintento en una operación
       distinta a ojos del servidor. Si la primera llegó a procesarse antes de
       que el guard la rechazara, la clave repetida es lo único que impide una
       segunda carga, una segunda entrega o un segundo gasto. */
    guardarSesion(SESION);
    const espia = encolarRespuestas(
      { estado: 401, cuerpo: {} },
      { estado: 200, cuerpo: SESION_NUEVA },
      { estado: 201, cuerpo: { id: 'g1' } },
    );
    await api.crear('/gastos/viaje/v1', { monto: 10 });

    const primera = (espia.mock.calls[0][1]?.headers as Headers).get('Idempotency-Key');
    const reintento = (espia.mock.calls[2][1]?.headers as Headers).get('Idempotency-Key');
    expect(primera).toBeTruthy();
    expect(reintento).toBe(primera);
  });

  it('si el refresco también falla, ahí sí borra la sesión y no reintenta', async () => {
    guardarSesion(SESION);
    const espia = encolarRespuestas(
      { estado: 401, cuerpo: {} },
      { estado: 401, cuerpo: { message: 'Sesión revocada. Inicia sesión de nuevo.' } },
    );
    await expect(api.listar('/viajes')).rejects.toThrow(ErrorApi);
    expect(leerSesion()).toBeNull();
    expect(espia).toHaveBeenCalledTimes(2);
  });

  it('el reintento que vuelve a dar 401 NO desencadena otro refresco', async () => {
    // Sin este freno, un backend que responda 401 a todo deja al cliente
    // refrescando en bucle mientras la pantalla se queda colgada.
    guardarSesion(SESION);
    const espia = encolarRespuestas(
      { estado: 401, cuerpo: {} },
      { estado: 200, cuerpo: SESION_NUEVA },
      { estado: 401, cuerpo: { message: 'No' } },
    );
    await expect(api.listar('/viajes')).rejects.toThrow(ErrorApi);
    expect(espia).toHaveBeenCalledTimes(3);
    expect(leerSesion()).toBeNull();
  });

  it('sin refreshToken no hay nada que refrescar: se comporta como antes', async () => {
    // La sesión de inscripción de MFA es exactamente este caso, por diseño.
    guardarSesion({ ...SESION, refreshToken: undefined });
    const espia = encolarRespuestas({ estado: 401, cuerpo: {} });
    await expect(api.listar('/viajes')).rejects.toThrow(ErrorApi);
    expect(espia).toHaveBeenCalledTimes(1);
    expect(leerSesion()).toBeNull();
  });

  it('cinco peticiones que caducan a la vez refrescan UNA sola vez', async () => {
    /* El caso real: una pantalla que carga cinco listas al abrirse, con el
       token recién vencido. Cinco refrescos con el mismo token en paralelo
       serían cinco rotaciones del `jti` en Redis: el primero gana y los otros
       cuatro reciben «Sesión revocada» — el usuario acabaría en `/entrar`
       JUSTO por el mecanismo que existe para no echarlo. */
    guardarSesion(SESION);
    const espia = jest.fn(async (url: string) => {
      if (String(url).includes('/auth/refrescar')) {
        return { ok: true, status: 200, json: async () => SESION_NUEVA };
      }
      const cabeceras = espia.mock.calls.at(-1)?.[1]?.headers as Headers | undefined;
      const caducado = cabeceras?.get('Authorization') === `Bearer ${SESION.accessToken}`;
      return { ok: !caducado, status: caducado ? 401 : 200, json: async () => [] };
    }) as unknown as EspiaFetch;
    global.fetch = espia as unknown as typeof fetch;

    await Promise.all([
      api.listar('/viajes'), api.listar('/ordenes'), api.listar('/clientes'),
      api.listar('/productos'), api.listar('/cisternas'),
    ]);

    const refrescos = rutasPedidas(espia).filter(r => r.includes('/auth/refrescar'));
    expect(refrescos).toHaveLength(1);
  });
});

describe('cerrar sesión', () => {
  it('revoca el refresco en el servidor, no sólo en el navegador', async () => {
    /* Borrar `localStorage` deja el refresh token vivo en Redis hasta que
       venza. Quien tenga una copia —una máquina compartida, un volcado del
       almacenamiento— sigue pudiendo pedir tokens de acceso nuevos después de
       que la persona haya «cerrado sesión». */
    guardarSesion(SESION);
    const espia = fingirRespuesta(204, null);
    await cerrarSesion();
    expect(rutasPedidas(espia)[0]).toContain('/auth/cerrar-sesion');
    expect(JSON.parse(String(peticionDe(espia).body))).toEqual({ refreshToken: 'refresco' });
  });

  it('la sesión local se va SIEMPRE, aunque el servidor no conteste', async () => {
    // Si un fallo de red dejara la sesión puesta, el botón de salir no
    // funcionaría justo cuando más falta hace: en una máquina ajena sin buena
    // conexión.
    guardarSesion(SESION);
    global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(cerrarSesion()).resolves.toBeUndefined();
    expect(leerSesion()).toBeNull();
  });

  it('sin sesión no llama a nadie', async () => {
    const espia = fingirRespuesta(204, null);
    await cerrarSesion();
    expect(espia).not.toHaveBeenCalled();
  });
});
