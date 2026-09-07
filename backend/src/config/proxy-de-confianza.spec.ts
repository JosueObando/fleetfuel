import express from 'express';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ConfigService } from '@nestjs/config';
import type { Logger } from '@nestjs/common';
import { listaDeProxiesDeConfianza, configurarProxyDeConfianza } from './proxy-de-confianza';

/**
 * Monta Express PASANDO POR la función de producción, y no repitiendo su
 * `app.set` a mano.
 *
 * Esa repetición era un punto ciego con forma de prueba: todo lo de este
 * fichero comprobaba la propiedad de la LISTA, y nada comprobaba que
 * `configurarProxyDeConfianza` fuera quien la instalaba. Medido cambiando su
 * `app.set('trust proxy', lista)` por `true` —el valor que su propio comentario
 * prohíbe, y que deja a cualquiera falsificar su IP en la auditoría y esquivar
 * el freno por IP del login—: las 373 pruebas del backend seguían en verde.
 */
function configurado(valor: string): express.Express {
  const expressApp = express();
  const app = { set: (k: string, v: unknown) => expressApp.set(k, v) } as unknown as NestExpressApplication;
  const config = { get: () => valor } as unknown as ConfigService;
  const log = { log: () => undefined } as unknown as Logger;
  configurarProxyDeConfianza(app, config, log);
  return expressApp;
}

describe('listaDeProxiesDeConfianza', () => {
  it('no confía en nadie cuando la variable está vacía o ausente', () => {
    expect(listaDeProxiesDeConfianza(undefined)).toEqual([]);
    expect(listaDeProxiesDeConfianza('')).toEqual([]);
    // Una variable puesta pero en blanco NO puede significar «confía en todos»:
    // sería exactamente el `trust proxy: true` que este código evita.
    expect(listaDeProxiesDeConfianza('   ')).toEqual([]);
    expect(listaDeProxiesDeConfianza(',,')).toEqual([]);
  });

  it('acepta varios proxies con espacios alrededor', () => {
    expect(listaDeProxiesDeConfianza(' 10.0.0.19 , 10.0.0.20 '))
      .toEqual(['10.0.0.19', '10.0.0.20']);
  });
});

/*
 * Lo que se fija aquí no es la lista, es la CADENA: nuestra lista → la
 * compilación de Express → la IP que acaba en la auditoría.
 *
 * El detalle que lo hace necesario: Node acepta las conexiones en un socket de
 * doble pila, así que una IPv4 llega como IPv4 MAPEADA en IPv6
 * (`::ffff:10.0.0.19`) mientras la lista está escrita en IPv4 pura
 * (`10.0.0.19`). Si esa equivalencia dejara de cumplirse, el proxy real no
 * sería de confianza, la auditoría guardaría SU IP en vez de la del usuario, y
 * no habría ni un error ni un aviso: la aplicación seguiría funcionando y la
 * traza de «quién entró desde dónde» estaría corrupta desde ese día.
 *
 * Es el mismo fallo silencioso contra el que se escribió `trust proxy`, colado
 * por la puerta de atrás.
 */
describe('la cadena de confianza frente a las direcciones que manda Node', () => {
  /** La función que Express compila a partir de la lista, que es la que decide. */
  const decisorPara = (valor: string) =>
    configurado(valor).get('trust proxy fn') as (ip: string, salto: number) => boolean;

  const confia = decisorPara('10.0.0.19');

  it('confía en el proxy escrito en IPv4 pura', () => {
    expect(confia('10.0.0.19', 0)).toBe(true);
  });

  it('confía en el proxy cuando llega como IPv4 mapeada en IPv6', () => {
    expect(confia('::ffff:10.0.0.19', 0)).toBe(true);
  });

  it('NO confía en la máquina de la aplicación', () => {
    expect(confia('10.0.0.193', 0)).toBe(false);
    expect(confia('::ffff:10.0.0.193', 0)).toBe(false);
  });

  it('NO confía en un cliente cualquiera de la LAN', () => {
    // Si confiara, ese cliente podría falsificar su propia IP en la auditoría
    // con una cabecera X-Forwarded-For inventada.
    expect(confia('10.0.0.50', 0)).toBe(false);
  });

  it('no confía en nadie cuando la lista está vacía', () => {
    expect(decisorPara('')('10.0.0.19', 0)).toBe(false);
  });
});

/*
 * La misma propiedad, pero recorrida de verdad por una petición HTTP: el socket
 * de supertest llega por la interfaz local, que Node entrega precisamente como
 * IPv4 mapeada. Así que confiar en el `127.0.0.1` pura de la lista y ver que
 * `req.ip` sale del X-Forwarded-For demuestra el mapeo de extremo a extremo.
 */
describe('la IP que acaba en la auditoría', () => {
  const appCon = (valor: string) => {
    const app = configurado(valor);
    app.get('/eco', (req, res) => { res.json({ ip: req.ip }); });
    return app;
  };

  it('toma la del cliente cuando la petición viene de un proxy de confianza', async () => {
    const r = await request(appCon('127.0.0.1'))
      .get('/eco').set('X-Forwarded-For', '190.34.12.7');
    expect(r.body.ip).toBe('190.34.12.7');
  });

  it('ignora el X-Forwarded-For de quien NO es de confianza', async () => {
    // Un cliente cualquiera diciendo que viene de otra IP: la cabecera se
    // descarta y queda la del socket. Registrar una IP falsa sería peor que
    // no registrar ninguna.
    const r = await request(appCon('10.0.0.19'))
      .get('/eco').set('X-Forwarded-For', '1.2.3.4');
    expect(r.body.ip).not.toBe('1.2.3.4');
  });

  it('sin proxy configurado usa siempre la del socket', async () => {
    const r = await request(appCon(''))
      .get('/eco').set('X-Forwarded-For', '1.2.3.4');
    expect(r.body.ip).not.toBe('1.2.3.4');
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Lo que `configurarProxyDeConfianza` le entrega a Express.
 *
 * Los bloques de arriba prueban el COMPORTAMIENTO resultante; éste prueba la
 * forma del valor, porque es donde está la prohibición explícita del fichero:
 * «Se confía en una lista explícita de proxies y NUNCA en `true`».
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('lo que se le pasa a Express', () => {
  const espiar = (valor: string) => {
    const puestos: Array<[string, unknown]> = [];
    const app = { set: (k: string, v: unknown) => { puestos.push([k, v]); } } as unknown as NestExpressApplication;
    const config = { get: () => valor } as unknown as ConfigService;
    const log = { log: () => undefined } as unknown as Logger;
    configurarProxyDeConfianza(app, config, log);
    return puestos;
  };

  it('instala la LISTA, nunca `true`', () => {
    const puestos = espiar('10.0.0.19, 10.0.0.20');
    expect(puestos).toEqual([['trust proxy', ['10.0.0.19', '10.0.0.20']]]);
    // Dicho aparte y a propósito: es la afirmación que falla si alguien
    // «simplifica» a `true`, y el motivo por el que este bloque existe.
    expect(puestos[0][1]).not.toBe(true);
  });

  it('sin proxies no toca `trust proxy` en absoluto', () => {
    // No es lo mismo instalar una lista vacía que no instalar nada: se deja el
    // valor por omisión de Express, que es no confiar en nadie. Tocarlo para
    // decir «nadie» sólo añade una forma más de equivocarse.
    expect(espiar('')).toEqual([]);
    expect(espiar('   ')).toEqual([]);
  });

  it('avisa por el registro en los dos casos, que es como se descubre en un despliegue', () => {
    const lineas: string[] = [];
    const log = { log: (m: string) => lineas.push(m) } as unknown as Logger;
    const app = { set: () => undefined } as unknown as NestExpressApplication;
    configurarProxyDeConfianza(app, { get: () => '' } as unknown as ConfigService, log);
    configurarProxyDeConfianza(app, { get: () => '10.0.0.19' } as unknown as ConfigService, log);
    expect(lineas[0]).toMatch(/Sin proxy de confianza/);
    expect(lineas[1]).toMatch(/10\.0\.0\.19/);
  });
});
