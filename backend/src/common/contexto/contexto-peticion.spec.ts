import { contextoActual, contextoOpcional, gestor, auditar, ejecutarEnContexto } from './contexto-peticion';

/*
 * El contexto de empresa. Es de lo que cuelga TODO el aislamiento entre
 * operadoras: `gestor()` devuelve el `EntityManager` de la transacción que
 * tiene fijado `app.empresa_id`, y la RLS no distingue entre «otra empresa» y
 * «sin contexto» — las dos devuelven cero filas.
 *
 * Por eso el camino sin contexto REVIENTA en vez de devolver algo: consultar
 * sin aislamiento es peor que fallar.
 */

const contextoFalso = () => ({
  empresaId: '1', usuarioId: '7',
  manager: { marca: 'gestor de prueba' } as never,
  cambios: [],
});

describe('fuera de una petición', () => {
  it('pedir el contexto revienta, no devuelve nada', () => {
    // Pasa si un servicio se llama desde un job o un listener sin envolverlo.
    expect(() => contextoActual()).toThrow(/No hay contexto de empresa/);
  });

  it('el mensaje dice CÓMO arreglarlo', () => {
    // Un «no hay contexto» a secas manda a leer el código; nombrar la función
    // que hay que usar resuelve el problema en el sitio.
    expect(() => contextoActual()).toThrow(/ejecutarEnContexto/);
  });

  it('`gestor()` revienta igual: no hay atajo', () => {
    expect(() => gestor()).toThrow(/No hay contexto de empresa/);
  });

  it('`auditar()` también, en vez de perder el rastro en silencio', () => {
    expect(() => auditar({ entidad: 'x' })).toThrow(/No hay contexto de empresa/);
  });

  it('la versión OPCIONAL sí devuelve indefinido', () => {
    // Existe para el interceptor de registro, que corre antes de que haya
    // contexto y no puede reventar por eso.
    expect(contextoOpcional()).toBeUndefined();
  });
});

describe('dentro de una petición', () => {
  it('devuelve el contexto de ESA ejecución', () => {
    const ctx = contextoFalso();
    ejecutarEnContexto(ctx, () => {
      expect(contextoActual().empresaId).toBe('1');
      expect(gestor()).toBe(ctx.manager);
      expect(contextoOpcional()).toBe(ctx);
    });
  });

  it('los cambios auditados se acumulan en el contexto', () => {
    const ctx = contextoFalso();
    ejecutarEnContexto(ctx, () => {
      auditar({ entidad: 'clientes', entidadId: '5' });
      auditar({ entidad: 'clientes', entidadId: '6' });
    });
    expect(ctx.cambios).toHaveLength(2);
  });

  it('dos ejecuciones NO se ven entre sí', () => {
    // Es la garantía que hace que dos peticiones simultáneas de empresas
    // distintas no se mezclen. Si se filtrara, una operadora leería los datos
    // de otra sin que nada fallara.
    const a = { ...contextoFalso(), empresaId: 'A' };
    const b = { ...contextoFalso(), empresaId: 'B' };
    ejecutarEnContexto(a, () => {
      expect(contextoActual().empresaId).toBe('A');
      ejecutarEnContexto(b, () => expect(contextoActual().empresaId).toBe('B'));
      expect(contextoActual().empresaId).toBe('A');
    });
  });

  it('al salir, vuelve a no haber contexto', () => {
    ejecutarEnContexto(contextoFalso(), () => contextoActual());
    expect(() => contextoActual()).toThrow(/No hay contexto/);
  });
});
