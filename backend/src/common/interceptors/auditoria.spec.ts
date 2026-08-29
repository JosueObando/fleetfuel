import { sanear } from './auditoria.interceptor';

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
