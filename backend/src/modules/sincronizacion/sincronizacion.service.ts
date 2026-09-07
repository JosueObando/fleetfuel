import { Injectable } from '@nestjs/common';
import { gestor } from '../../common/contexto/contexto-peticion';
import { EventosService } from '../eventos/eventos.service';
import { LoteEventosDto, ElementoColaDto } from './dto/sincronizacion.dto';

export interface ResultadoElemento {
  idCliente: string;
  estado: 'creado' | 'duplicado' | 'rechazado';
  eventoId?: string;
  error?: string;
}

@Injectable()
export class SincronizacionService {
  constructor(private readonly eventos: EventosService) {}

  /**
   * Drenar la cola de salida de la app del conductor (§8, Fase 2A).
   *
   * TRES DECISIONES QUE DAN FORMA A TODO LO DEMAS
   *
   * 1 · EXITO PARCIAL, NO TODO O NADA. Si un elemento del lote es invalido
   *     —un viaje que se cancelo mientras el movil estaba sin cobertura, por
   *     ejemplo— rechazar el lote entero dejaria la cola atascada para siempre:
   *     la app reintentaria, volveria a fallar por lo mismo, y los cincuenta
   *     eventos buenos que van detras no entrarian nunca. Se responde 200 con
   *     el resultado DE CADA UNO, y la app borra de su cola los que aterrizaron.
   *
   * 2 · SAVEPOINTS. Toda la peticion corre en UNA transaccion, y en Postgres
   *     cualquier sentencia fallida la aborta entera: sin savepoints, el primer
   *     elemento invalido se llevaria por delante a los que ya habian entrado.
   *     Cada elemento se envuelve en el suyo y su fallo se deshace solo.
   *
   * 3 · EN ORDEN, Y SIN CORTAR. Se aplican en el orden en que la app los
   *     encolo, porque la cadena de hashes del §7.15 es una secuencia. Un
   *     rechazado no interrumpe: los siguientes se encadenan al ultimo que SI
   *     entro, que es lo que el viaje realmente tiene.
   */
  async drenarEventos(lote: LoteEventosDto): Promise<{
    recibidos: number; creados: number; duplicados: number; rechazados: number;
    resultados: ResultadoElemento[];
  }> {
    const resultados: ResultadoElemento[] = [];

    for (const [indice, elemento] of lote.eventos.entries()) {
      resultados.push(await this.aplicar(elemento, indice));
    }

    return {
      recibidos: lote.eventos.length,
      creados: resultados.filter((r) => r.estado === 'creado').length,
      duplicados: resultados.filter((r) => r.estado === 'duplicado').length,
      rechazados: resultados.filter((r) => r.estado === 'rechazado').length,
      resultados,
    };
  }

  private async aplicar(elemento: ElementoColaDto, indice: number): Promise<ResultadoElemento> {
    // Lo primero es preguntar si ya esta: un reintento de la cola trae de nuevo
    // lo que no llego a confirmarse, y volver a insertarlo seria duplicar el
    // evento aunque el hash saliera distinto.
    const [previo] = await gestor().query(
      `SELECT evento_id FROM eventos_viaje WHERE id_cliente = $1`, [elemento.idCliente]);
    if (previo) {
      return { idCliente: elemento.idCliente, estado: 'duplicado',
               eventoId: String(previo.evento_id) };
    }

    // Un savepoint por elemento. El nombre lleva el indice porque no se pueden
    // repetir dentro de la misma transaccion.
    const punto = `sp_sync_${indice}`;
    await gestor().query(`SAVEPOINT ${punto}`);
    try {
      const creado = await this.eventos.registrar(
        elemento.viajeId, elemento, elemento.idCliente);
      await gestor().query(`RELEASE SAVEPOINT ${punto}`);
      return { idCliente: elemento.idCliente, estado: 'creado', eventoId: String(creado.id) };
    } catch (e) {
      // Se vuelve al savepoint y la transaccion sigue viva para el resto.
      await gestor().query(`ROLLBACK TO SAVEPOINT ${punto}`);
      return {
        idCliente: elemento.idCliente, estado: 'rechazado',
        // El mensaje va al dispositivo para que pueda mostrarlo o descartarlo
        // con criterio, en vez de reintentar para siempre algo que nunca va a
        // entrar.
        error: (e as { message?: string }).message ?? 'Error desconocido',
      };
    }
  }
}
