import { aCampo, cambios, instante } from './cambios';

/*
 * Las tres ediciones (cisternas, órdenes y viajes) mandan un PATCH con SÓLO lo
 * que cambió. No es por ahorrar bytes:
 *
 *   · `PATCH /viajes/:id` responde 409 a un viaje en marcha si el cuerpo trae
 *     `cisternaId`, `conductorId` o `fechaProgramada` — aunque sean los mismos
 *     que ya tenía. Reenviar el formulario entero haría imposible anotar el
 *     odómetro de un viaje autorizado, que es justo cuando se anota.
 *   · la auditoría guarda antes y después: un PATCH con todo registra un
 *     «cambio» en cada campo que nadie tocó.
 */

describe('cambios', () => {
  it('sin tocar nada no manda nada', () => {
    expect(cambios({ material: 'acero', capacidad: '9000' },
                   { material: 'acero', capacidad: '9000' })).toEqual({});
  });

  it('manda sólo los campos que cambiaron', () => {
    expect(cambios({ material: 'acero', capacidad: '9000' },
                   { material: 'aluminio', capacidad: '9000' })).toEqual({ material: 'aluminio' });
  });

  it('vaciar un campo que tenía valor lo manda como null, no como cadena vacía', () => {
    // '' lo rechaza el validador (`@Length(2, …)`) y omitirlo no borraría nada:
    // null es la única forma de decirle a la API «quítalo».
    expect(cambios({ certificado: 'CAL-1' }, { certificado: '' })).toEqual({ certificado: null });
  });

  it('un campo que estaba vacío y sigue vacío no viaja', () => {
    expect(cambios({ certificado: '' }, { certificado: '' })).toEqual({});
  });

  it('aplica la conversión del campo sólo a lo que cambió', () => {
    const numero = jest.fn(Number);
    expect(cambios({ capacidad: '9000', material: 'acero' },
                   { capacidad: '9500', material: 'acero' },
                   { capacidad: numero, material: numero })).toEqual({ capacidad: 9500 });
    expect(numero).toHaveBeenCalledTimes(1);
  });

  it('la conversión no se aplica al null de un campo vaciado', () => {
    // Number('') es 0: convertir antes de mirar si está vacío mandaría un
    // odómetro a CERO en vez de quitarlo.
    expect(cambios({ odometro: '1200' }, { odometro: '' }, { odometro: Number }))
      .toEqual({ odometro: null });
  });
});

describe('aCampo', () => {
  it('null y undefined son un campo vacío', () => {
    expect(aCampo(null)).toBe('');
    expect(aCampo(undefined)).toBe('');
  });

  it('números y cadenas se escriben tal cual', () => {
    expect(aCampo(9000)).toBe('9000');
    expect(aCampo('9000.00')).toBe('9000.00');
  });

  it('una fecha se recorta al día que entiende un <input type="date">', () => {
    expect(aCampo('2027-01-15T00:00:00.000Z', 'fecha')).toBe('2027-01-15');
    expect(aCampo(null, 'fecha')).toBe('');
  });

  describe('fecha y hora, en la zona de Panamá', () => {
    /* `jest.config.mjs` fija la zona (UTC-5, sin horario de verano). En UTC
       —la de la máquina y la de CI— una implementación que ignorase la zona
       pasaría; esta primera prueba comprueba que la zona sigue puesta. */
    it('las pruebas corren de verdad en hora de Panamá', () => {
      expect(new Date('2026-10-01T13:30:00.000Z').getHours()).toBe(8);
    });

    it('se escribe en HORA LOCAL, como la pinta un datetime-local', () => {
      // El input no entiende la «Z»: le hace falta 'AAAA-MM-DDTHH:mm' sin zona.
      expect(aCampo('2026-10-01T13:30:00.000Z', 'fechaHora')).toBe('2026-10-01T08:30');
    });

    it('el cambio de día también se hace en local', () => {
      expect(aCampo('2026-10-01T02:00:00.000Z', 'fechaHora')).toBe('2026-09-30T21:00');
    });

    it('`instante` la devuelve al MISMO momento', () => {
      // Una ida y vuelta que moviera la hora reprogramaría la entrega en
      // silencio cada vez que alguien guardara otra cosa del formulario.
      expect(instante('2026-10-01T08:30')).toBe('2026-10-01T13:30:00.000Z');
    });
  });
});
