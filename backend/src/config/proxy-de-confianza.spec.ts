import express from 'express';
import request from 'supertest';
import { listaDeProxiesDeConfianza } from './proxy-de-confianza';

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
  const decisorPara = (valor: string) => {
    const app = express();
    app.set('trust proxy', listaDeProxiesDeConfianza(valor));
    return app.get('trust proxy fn') as (ip: string, salto: number) => boolean;
  };

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
    const app = express();
    app.set('trust proxy', listaDeProxiesDeConfianza(valor));
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
