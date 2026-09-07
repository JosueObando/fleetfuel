import { ExecutionContext } from '@nestjs/common';
import { of, firstValueFrom } from 'rxjs';
import { AuditoriaInterceptor, sanear, entidadDeRuta, idDe } from './auditoria.interceptor';
import { Contexto, ejecutarEnContexto } from '../contexto/contexto-peticion';

describe('saneado de la bitácora', () => {
  it('omite la clave pero conserva que hubo un cambio de clave', () => {
    const salida = sanear({ nombre: 'Ana', clave: 'Sup3rSecreta!' });
    expect(salida).toEqual({ nombre: 'Ana', clave: '«omitido»' });
  });

  it('omite secretos MFA y tokens', () => {
    const salida = sanear({ mfaSecreto: 'JBSWY3DP', refreshToken: 'ey...', codigoTotp: '123456' });
    expect(Object.values(salida as object)).toEqual(['«omitido»', '«omitido»', '«omitido»']);
  });

  it('desciende a objetos anidados', () => {
    const salida = sanear({ usuario: { nombre: 'Ana', cedula: '8-888-8888' } });
    expect(salida).toEqual({ usuario: { nombre: 'Ana', cedula: '«omitido»' } });
  });

  it('deja pasar lo que no es sensible', () => {
    expect(sanear({ estado: 'suspendido', motivo: 'Cese de funciones' }))
      .toEqual({ estado: 'suspendido', motivo: 'Cese de funciones' });
  });

  it('un valor que no es objeto no produce registro', () => {
    expect(sanear('texto')).toBeNull();
    expect(sanear(null)).toBeNull();
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * La rama de RESERVA del interceptor: la que corre cuando un servicio NO llamó
 * a `auditar()`.
 *
 * Es la razón de ser del interceptor. La §4 dice por qué no puede depender de
 * que alguien se acuerde: «tarde o temprano falta un registro y el §21 deja de
 * cumplirse». Pero la reserva no tenía ninguna prueba —79 % de sentencias y
 * 50 % de ramas, lo peor del backend— porque los doce módulos con mutaciones sí
 * llaman a `auditar()`, así que en la suite entera no se ejercitaba nunca.
 *
 * Y estaba rota: `setGlobalPrefix('api')` hace que el primer segmento sea `api`
 * en TODAS las rutas, así que la bitácora habría dicho `entidad = 'api'` para
 * cualquier cosa. Constancia de que algo pasó, sin decir de qué — que es lo
 * único para lo que sirve la columna.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('entidadDeRuta · de qué habla el registro cuando nadie lo dijo', () => {
  it('se salta el prefijo global y nombra el recurso', () => {
    expect(entidadDeRuta({ route: { path: '/api/clientes' } })).toBe('clientes');
  });

  it('en un subrecurso nombra el recurso RAÍZ, no el último tramo', () => {
    // `viajes` y no `plan-carga`: la columna `entidad` contiene hoy nombres de
    // tabla —`viajes`, `plan_carga`, `clientes`— y la reserva tiene que caer
    // dentro de ese vocabulario, no inventar uno nuevo justo el día en que algo
    // ya salió mal. Lo mismo evita que entren verbos como `autorizar`.
    expect(entidadDeRuta({ route: { path: '/api/viajes/:id/plan-carga' } })).toBe('viajes');
    expect(entidadDeRuta({ route: { path: '/api/viajes/:id/autorizar' } })).toBe('viajes');
    expect(entidadDeRuta({ route: { path: '/api/ordenes/:id/estado' } })).toBe('ordenes');
  });

  it('nunca devuelve el prefijo, que es lo que devolvía antes SIEMPRE', () => {
    for (const path of ['/api/clientes', '/api/viajes/:id/estado', '/api/auth/mfa/iniciar']) {
      expect(entidadDeRuta({ route: { path } })).not.toBe('api');
    }
  });

  it('cae a la url cuando no hay ruta emparejada, y le quita la consulta', () => {
    expect(entidadDeRuta({ url: '/api/clientes?estado=activo' })).toBe('clientes');
  });

  it('sin ruta ni url lo dice, en vez de inventarse una entidad', () => {
    expect(entidadDeRuta({})).toBe('desconocida');
  });

  it('una ruta sin el prefijo también se nombra bien', () => {
    // El prefijo se fija en `main.ts`; una prueba de extremo a extremo o un
    // montaje distinto pueden no traerlo, y eso no debe dejar la entidad vacía.
    expect(entidadDeRuta({ route: { path: '/clientes' } })).toBe('clientes');
  });
});

describe('idDe · qué identificador queda en el registro', () => {
  it('prefiere `id`', () => {
    expect(idDe({ id: 42, usuarioId: 7 })).toBe('42');
  });

  it('acepta los identificadores propios de cada módulo', () => {
    expect(idDe({ usuarioId: 7 })).toBe('7');
    expect(idDe({ rolId: 3 })).toBe('3');
    expect(idDe({ empresaId: 1 })).toBe('1');
    expect(idDe({ dispositivoId: 9 })).toBe('9');
  });

  it('un cero es un identificador, no un ausente', () => {
    // `id ?? ...` y `== null` están puestos justo para esto; con `||` o con `!id`
    // el registro de la fila 0 se quedaría sin identificador.
    expect(idDe({ id: 0 })).toBe('0');
  });

  it('un identificador que no es primitivo no se convierte en «[object Object]»', () => {
    // Lo encontró ESLint con tipos (`no-base-to-string`), no estas pruebas: el
    // `String(id)` de antes convertía cualquier objeto anidado en la cadena
    // literal «[object Object]» y la metía en `entidad_id`. Un identificador
    // ilegible en la bitácora es peor que no tener ninguno: parece un dato.
    expect(idDe({ id: { anidado: 1 } })).toBeNull();
    expect(idDe({ usuarioId: ['a'] })).toBeNull();
    expect(idDe({ id: true })).toBeNull();
  });

  it('acepta el bigint, que es lo que devuelve Postgres para un id grande', () => {
    expect(idDe({ id: 9007199254740993n })).toBe('9007199254740993');
  });

  it('sin nada reconocible devuelve null, no "undefined"', () => {
    expect(idDe({ otraCosa: 1 })).toBeNull();
    expect(idDe('texto')).toBeNull();
    expect(idDe(null)).toBeNull();
  });
});

/*
 * Que los ayudantes acierten no basta: hay que comprobar que el interceptor los
 * USA. Un `entidadDeRuta` correcto pero desconectado pasaría todo lo de arriba.
 */
describe('el interceptor, cuando el servicio no declaró nada', () => {
  function contextoHttp(peticion: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => peticion }),
    } as unknown as ExecutionContext;
  }

  it('registra la entidad del recurso y omite lo sensible del cuerpo', async () => {
    const consultas: unknown[][] = [];
    const contexto: Contexto = {
      empresaId: '1', usuarioId: '7',
      manager: { query: (_sql: string, p: unknown[]) => { consultas.push(p); return Promise.resolve([]); } } as never,
      ip: '10.0.0.9', dispositivo: 'navegador', ruta: 'POST /api/clientes',
      cambios: [], // nadie llamó a `auditar()`: es la rama de reserva
    };

    const interceptor = new AuditoriaInterceptor();
    const peticion = {
      method: 'POST',
      route: { path: '/api/clientes' },
      body: { nombre: 'Ana', clave: 'Sup3rSecreta!' },
    };
    const siguiente = { handle: () => of({ id: 55, nombre: 'Ana' }) };

    await ejecutarEnContexto(contexto, () =>
      firstValueFrom(interceptor.intercept(contextoHttp(peticion), siguiente as never)));

    expect(consultas).toHaveLength(1);
    const [empresaId, usuarioId, accion, entidad, entidadId, , valorNuevo] = consultas[0];
    expect(empresaId).toBe('1');
    expect(usuarioId).toBe('7');
    expect(accion).toBe('POST');
    expect(entidad).toBe('clientes');
    expect(entidadId).toBe('55');
    expect(JSON.parse(valorNuevo as string)).toEqual({ nombre: 'Ana', clave: '«omitido»' });
  });

  it('una lectura no deja registro: sólo se auditan las mutaciones', async () => {
    let llamadas = 0;
    const contexto: Contexto = {
      empresaId: '1', usuarioId: '7',
      manager: { query: () => { llamadas++; return Promise.resolve([]); } } as never,
      cambios: [],
    };
    const interceptor = new AuditoriaInterceptor();
    const peticion = { method: 'GET', route: { path: '/api/clientes' }, body: {} };

    await ejecutarEnContexto(contexto, () =>
      firstValueFrom(interceptor.intercept(contextoHttp(peticion), { handle: () => of([]) } as never)));

    expect(llamadas).toBe(0);
  });
});
