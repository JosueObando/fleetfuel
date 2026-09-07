import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

import { SolicitudesRutaService } from '../src/modules/solicitudes-ruta/solicitudes-ruta.service';
import { ejecutarEnContexto, gestor } from '../src/common/contexto/contexto-peticion';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * §2C · Solicitudes de cambio de ruta.
 *
 * Alcance nuevo: sale del spec de UX y no del PRD. La distinción que ordena
 * todo lo de aquí: el §22 del PRD tiene una ALERTA de desvío —reactiva, el
 * sistema se entera de que el camión se salió— y esto es un flujo de
 * APROBACIÓN —alguien pide salirse y otro lo autoriza—. No se sustituyen.
 */

const comun = {
  type: 'postgres' as const,
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5433', 10),
  database: process.env.DATABASE_NAME || 'fleetfuel_db',
};
const dueño = new DataSource({
  ...comun,
  username: process.env.DATABASE_USER || 'fleetfuel_owner',
  password: process.env.DATABASE_PASSWORD || 'cambiar_en_produccion',
});
const app = new DataSource({
  ...comun,
  username: process.env.DATABASE_APP_USER || 'fleetfuel_app',
  password: process.env.DATABASE_APP_PASSWORD || 'cambiar_en_produccion_app',
});

const servicio = new SolicitudesRutaService();
let empresa: string, quienPide: string, quienResuelve: string;
let cisterna: string, conductor: string;
let secuencia = 0, ultimoViaje: string | null = null;

/** Corre como una petición real de `usuarioId`. */
async function comoUsuario<T>(usuarioId: string, fn: (s: SolicitudesRutaService) => Promise<T>) {
  const runner = app.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresa]);
    return await ejecutarEnContexto(
      { empresaId: empresa, usuarioId, manager: runner.manager, cambios: [] },
      () => fn(servicio),
    );
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    ultimoViaje = null;
  }
}

/** Un viaje EN MARCHA, que es cuando pedir un cambio de ruta significa algo. */
async function viajeEnMarcha(estado = 'transito_estacion'): Promise<string> {
  if (ultimoViaje) {
    await gestor().query(
      `UPDATE viajes SET estado = 'cerrado', fecha_fin = fecha_programada + interval '4 hours'
        WHERE viaje_id = $1`, [ultimoViaje]);
  }
  const [v] = await gestor().query(
    `INSERT INTO viajes (empresa_id, codigo_viaje, tipo_viaje, cisterna_id, conductor_id,
                         fecha_programada, estado)
     VALUES ($1,$2,'simple',$3,$4,$5,$6) RETURNING viaje_id`,
    [empresa, `SOL-${Math.random().toString(36).slice(2, 9)}`, cisterna, conductor,
     new Date(Date.UTC(2031, 0, 1 + secuencia++, 8)).toISOString(), estado]);
  ultimoViaje = String(v.viaje_id);
  return ultimoViaje;
}

const peticion = (extra: Record<string, unknown> = {}) => ({
  tipo: 'desvio', motivo: 'Vía Centenario cerrada por accidente', ...extra,
});

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();

  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Solicitudes Test','SOL-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);

  const [u1] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Quien pide','sol-pide@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  quienPide = String(u1.usuario_id);
  const [u2] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Quien resuelve','sol-resuelve@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  quienResuelve = String(u2.usuario_id);

  const [veh] = await dueño.query(
    `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna','SOL-1')
     RETURNING vehiculo_id`, [empresa]);
  const [c] = await dueño.query(
    `INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total) VALUES ($1,$2,10000)
     RETURNING cisterna_id`, [empresa, veh.vehiculo_id]);
  cisterna = String(c.cisterna_id);
  const [cd] = await dueño.query(
    `INSERT INTO conductores (empresa_id, nombre_completo, documento, licencia)
     VALUES ($1,'Chofer Sol','SOL-D1','SOL-L1') RETURNING conductor_id`, [empresa]);
  conductor = String(cd.conductor_id);
});

afterAll(async () => {
  for (const t of ['solicitudes_ruta', 'viajes', 'cisternas', 'vehiculos', 'conductores',
                   'auditoria', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'SOL-TEST'`);
  await app.destroy();
  await dueño.destroy();
});

describe('pedir · qué solicitudes tienen sentido y cuáles no', () => {
  it('los tres tipos del spec se aceptan', async () => {
    await comoUsuario(quienPide, async (s) => {
      for (const tipo of ['desvio', 'parada_extra', 'cancelacion']) {
        const sol = await s.pedir(await viajeEnMarcha(), peticion({ tipo }));
        expect(sol.tipo).toBe(tipo);
        expect(sol.estado).toBe('pendiente');
      }
    });
  });

  it('un tipo que no está en el spec se rechaza', async () => {
    await comoUsuario(quienPide, async (s) => {
      await expect(s.pedir(await viajeEnMarcha(), peticion({ tipo: 'volar' }) as never))
        .rejects.toThrow(/tipo/i);
    });
  });

  it('nace PENDIENTE y sin resolver: nadie se aprueba a sí mismo de entrada', async () => {
    await comoUsuario(quienPide, async (s) => {
      const sol = await s.pedir(await viajeEnMarcha(), peticion());
      expect(sol.estado).toBe('pendiente');
      expect(sol.resueltaPor).toBeNull();
      expect(sol.resueltaEn).toBeNull();
      expect(String(sol.solicitadaPor)).toBe(quienPide);
    });
  });

  it('un viaje que aún no ha salido no admite cambios de ruta', async () => {
    // Pedir un desvío de una ruta que todavía se puede replanificar es usar el
    // flujo equivocado: para eso está editar el viaje, que no necesita que
    // nadie apruebe nada.
    await comoUsuario(quienPide, async (s) => {
      await expect(s.pedir(await viajeEnMarcha('borrador'), peticion() as never))
        .rejects.toThrow(/todavía no ha salido/);
    });
  });

  it('un viaje ya cerrado tampoco', async () => {
    await comoUsuario(quienPide, async (s) => {
      await expect(s.pedir(await viajeEnMarcha('cerrado'), peticion() as never))
        .rejects.toThrow(/ya terminó/);
    });
  });

  it('un viaje que no existe da 404', async () => {
    await comoUsuario(quienPide, async (s) => {
      await expect(s.pedir('999999999', peticion() as never)).rejects.toThrow(/no encontrado/i);
    });
  });

  it('el motivo no puede ser un hueco', async () => {
    // Una solicitud sin razón legible es exactamente lo que este flujo existe
    // para no permitir: el registro que deja no probaría nada.
    await comoUsuario(quienPide, async (s) => {
      await expect(s.pedir(await viajeEnMarcha(), peticion({ motivo: '   ' }) as never))
        .rejects.toThrow();
    });
  });
});

describe('resolver · quien pide NO resuelve', () => {
  it('el mismo usuario no puede aprobar su propia solicitud', async () => {
    // La regla que hace que esto sea un control y no un formulario. Sin ella,
    // «solicitud de cambio de ruta» es el conductor autorizándose el desvío, y
    // la traza que queda no prueba nada.
    let id = '';
    await comoUsuario(quienPide, async (s) => {
      id = String((await s.pedir(await viajeEnMarcha(), peticion())).id);
      await expect(s.resolver(id, { estado: 'aprobada', motivo: 'me la apruebo' }))
        .rejects.toThrow(/uien la pidió no puede resolverla/);
    });
  });

  it('otro usuario sí, y queda quién y cuándo', async () => {
    await comoUsuario(quienPide, async (s) => {
      const sol = await s.pedir(await viajeEnMarcha(), peticion());
      // Dentro de la misma transacción, cambiando de actor: es lo que hace un
      // despachador distinto atendiendo la solicitud.
      const resuelta = await ejecutarEnContexto(
        { ...contextoDe(quienResuelve), manager: gestor() },
        () => servicio.resolver(String(sol.id),
          { estado: 'aprobada', motivo: 'Confirmado con tránsito' }),
      );
      expect(resuelta.estado).toBe('aprobada');
      expect(String(resuelta.resueltaPor)).toBe(quienResuelve);
      expect(resuelta.resueltaEn).not.toBeNull();
      expect(resuelta.motivoResolucion).toBe('Confirmado con tránsito');
    });
  });

  it('rechazar exige motivo: un «no» sin razón no es una decisión', async () => {
    await comoUsuario(quienPide, async (s) => {
      const sol = await s.pedir(await viajeEnMarcha(), peticion());
      await expect(ejecutarEnContexto(
        { ...contextoDe(quienResuelve), manager: gestor() },
        () => servicio.resolver(String(sol.id), { estado: 'rechazada' } as never),
      )).rejects.toThrow(/motivo/i);
    });
  });

  it('una solicitud ya resuelta no se vuelve a resolver', async () => {
    await comoUsuario(quienPide, async (s) => {
      const sol = await s.pedir(await viajeEnMarcha(), peticion());
      const resolver = (motivo: string) => ejecutarEnContexto(
        { ...contextoDe(quienResuelve), manager: gestor() },
        () => servicio.resolver(String(sol.id), { estado: 'aprobada', motivo }),
      );
      await resolver('Primera vez');
      await expect(resolver('Segunda vez')).rejects.toThrow(/ya está/);
    });
  });

  it('no se puede resolver a un estado que no es una resolución', async () => {
    await comoUsuario(quienPide, async (s) => {
      const sol = await s.pedir(await viajeEnMarcha(), peticion());
      await expect(ejecutarEnContexto(
        { ...contextoDe(quienResuelve), manager: gestor() },
        () => servicio.resolver(String(sol.id), { estado: 'pendiente', motivo: 'x' }),
      )).rejects.toThrow();
    });
  });
});

describe('listar', () => {
  it('las del viaje salen de la más nueva a la más vieja', async () => {
    await comoUsuario(quienPide, async (s) => {
      const viaje = await viajeEnMarcha();
      await s.pedir(viaje, peticion({ motivo: 'Primera solicitud del viaje' }));
      await s.pedir(viaje, peticion({ tipo: 'parada_extra', motivo: 'Segunda del viaje' }));
      const lista = await s.listarDeViaje(viaje);
      expect(lista).toHaveLength(2);
      expect(lista[0].motivo).toContain('Segunda');
    });
  });

  it('las pendientes de toda la empresa, que es lo que mira un despachador', async () => {
    await comoUsuario(quienPide, async (s) => {
      const sol = await s.pedir(await viajeEnMarcha(), peticion());
      const pendientes = await s.pendientes();
      expect(pendientes.map((p: { id: string }) => String(p.id))).toContain(String(sol.id));

      await ejecutarEnContexto(
        { ...contextoDe(quienResuelve), manager: gestor() },
        () => servicio.resolver(String(sol.id), { estado: 'rechazada', motivo: 'No procede' }),
      );
      const despues = await s.pendientes();
      expect(despues.map((p: { id: string }) => String(p.id))).not.toContain(String(sol.id));
    });
  });

  it('una solicitud que no existe da 404', async () => {
    await comoUsuario(quienPide, async (s) => {
      await expect(s.obtener('999999999')).rejects.toThrow(/no encontrada/i);
    });
  });
});

/** El mismo contexto pero con otro actor, para probar la separación. */
function contextoDe(usuarioId: string) {
  return { empresaId: empresa, usuarioId, cambios: [] as never[] };
}
