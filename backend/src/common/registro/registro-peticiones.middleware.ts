import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { normalizarIp } from '../ip';

/**
 * Una línea JSON por petición HTTP, a stdout.
 *
 * Hasta ahora el backend no registraba NI UNA petición: 214 líneas de log en
 * producción, todas de arranque. No había forma de saber quién llamó a qué, ni
 * de ver un ataque en curso, ni de responder «¿cuándo empezó a fallar?».
 *
 * POR QUÉ MIDDLEWARE Y NO UN INTERCEPTOR
 *
 * En Nest el orden es middleware → guards → interceptores → handler. Si un
 * guard rechaza —un 401 del JWT, un 429 del freno del login— la excepción sube
 * y el interceptor NUNCA se ejecuta. O sea que justo el tráfico que más
 * interesa registrar sería el único que no se registrara. El middleware corre
 * antes que todo y se engancha a `finish`, así que ve el código final venga de
 * donde venga, incluido lo que escribe el filtro de excepciones.
 *
 * QUÉ NO SE REGISTRA, A PROPÓSITO
 *
 * El cuerpo, nunca. `POST /auth/login` lleva la clave y el código TOTP en el
 * suyo: un registro que lo copiara convertiría el propio sistema de
 * observabilidad en el sitio donde están todas las contraseñas en claro. Y de
 * la cadena de consulta van sólo las CLAVES, no los valores — sirve para saber
 * qué filtros se usaron sin arrastrar lo que se buscó.
 */
@Injectable()
export class RegistroPeticionesMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const arranque = process.hrtime.bigint();

    // Un id por petición, devuelto en la cabecera: es lo que permite pegar una
    // queja concreta («me dio error a las 10:03») con su línea de registro sin
    // buscar por hora, que en un segundo con tráfico no distingue nada.
    const idPeticion = randomUUID();
    res.setHeader('X-Request-Id', idPeticion);

    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - arranque) / 1e6;
      // `req.user` lo pone JwtAuthGuard, que corre DESPUÉS de este middleware.
      // Para cuando 'finish' se dispara ya está, y por eso se lee aquí y no
      // arriba: leerlo antes daría siempre indefinido.
      const usuario = (req as Request & { user?: { id?: string; empresaId?: string } }).user;

      escribir({
        ts: new Date().toISOString(),
        nivel: nivelPara(res.statusCode),
        tipo: 'peticion',
        idPeticion,
        metodo: req.method,
        ruta: req.baseUrl + req.path,
        // Sólo los nombres de los parámetros. Ver la nota de arriba.
        consulta: Object.keys(req.query),
        estado: res.statusCode,
        ms: Math.round(ms * 10) / 10,
        ip: normalizarIp(req.ip),
        usuarioId: usuario?.id,
        empresaId: usuario?.empresaId,
        agente: recortar(req.get('user-agent')),
      });
    });

    next();
  }
}

function nivelPara(estado: number): 'error' | 'aviso' | 'info' {
  if (estado >= 500) return 'error';
  if (estado >= 400) return 'aviso';
  return 'info';
}

function recortar(valor: string | undefined, ancho = 160): string | undefined {
  if (!valor) return undefined;
  return valor.length > ancho ? `${valor.slice(0, ancho)}…` : valor;
}

/**
 * Se escribe a stdout en crudo y no con el `Logger` de Nest a propósito: el
 * Logger antepone su prefijo con colores ANSI, y eso rompe el análisis de JSON
 * en Promtail. Una línea, un objeto, sin adornos.
 *
 * `JSON.stringify` omite las claves con `undefined`, así que las peticiones sin
 * usuario no arrastran campos vacíos.
 */
function escribir(registro: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(registro)}\n`);
}
