import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { from, Observable } from 'rxjs';
import { Contexto, ejecutarEnContexto } from '../contexto/contexto-peticion';
import { UsuarioAutenticado } from '../decorators/usuario-actual.decorator';

/**
 * Abre una transacción por petición y fija en ella el contexto de empresa.
 *
 * Esta es la consecuencia que ADR 003 acepta: «toda consulta necesita el
 * contexto de sesión; el pool de conexiones debe fijarlo por petición».
 *
 * Tiene que ser SET LOCAL dentro de una transacción, no SET a secas: con un
 * pool, un SET de sesión sobrevive a la petición y la siguiente hereda la
 * empresa de la anterior — una fuga de datos entre operadoras que además es
 * intermitente, porque depende de qué conexión reparta el pool.
 *
 * El efecto secundario es deseable: cada petición es atómica. El dominio es
 * fuertemente transaccional (§3 — crear un viaje toca órdenes, cisternas,
 * compartimentos y conductores a la vez), así que esto es la base sobre la que
 * esas invariantes se sostienen, no un costo.
 */
@Injectable()
export class ContextoEmpresaInterceptor implements NestInterceptor {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const peticion = ctx.switchToHttp().getRequest();
    const usuario: UsuarioAutenticado | undefined = peticion.user;

    // Rutas públicas (login, salud): no hay empresa que fijar todavía. El login
    // resuelve su propio contexto una vez que sabe a qué empresa pertenece el
    // correo, y lo hace con el dueño del esquema en una transacción acotada.
    if (!usuario) return next.handle();

    return from(this.conTransaccion(peticion, usuario, next));
  }

  private async conTransaccion(
    peticion: Record<string, any>,
    usuario: UsuarioAutenticado,
    next: CallHandler,
  ): Promise<unknown> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      // set_config con parámetro en vez de interpolar: empresaId sale de un JWT
      // firmado, pero un GUC construido por concatenación es una inyección
      // esperando a que alguien afloje la validación del token.
      await runner.query(`SELECT set_config('app.empresa_id', $1, true)`, [usuario.empresaId]);
      await runner.query(`SELECT set_config('app.usuario_id', $1, true)`, [usuario.id]);

      const contexto: Contexto = {
        empresaId: usuario.empresaId,
        usuarioId: usuario.id,
        manager: runner.manager,
        ip: peticion.ip,
        dispositivo: peticion.headers?.['user-agent'],
        ruta: `${peticion.method} ${peticion.route?.path ?? peticion.url}`,
        cambios: [],
      };
      peticion.contextoFleetFuel = contexto;

      const resultado = await ejecutarEnContexto(contexto, () =>
        firstValueFromCompat(next.handle()),
      );
      await runner.commitTransaction();
      return resultado;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }
}

/** rxjs 7 exporta firstValueFrom, pero importarlo suelto complica el mock en
 *  pruebas unitarias; se aísla aquí para poder sustituirlo. */
function firstValueFromCompat(obs: Observable<unknown>): Promise<unknown> {
  return new Promise((resolver, rechazar) => {
    let ultimo: unknown;
    let hubo = false;
    obs.subscribe({
      next: (v) => { ultimo = v; hubo = true; },
      error: rechazar,
      complete: () => (hubo ? resolver(ultimo) : resolver(undefined)),
    });
  });
}
