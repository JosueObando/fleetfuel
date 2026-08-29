import { SetMetadata } from '@nestjs/common';

export const ES_PUBLICO = 'esPublico';
/** Marca un endpoint como público (sin JWT). Ej: login, salud. */
export const Publico = () => SetMetadata(ES_PUBLICO, true);
