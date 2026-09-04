'use client';

import { Catalogo } from '@/catalogos/Catalogo';
import { CATALOGOS } from '@/catalogos/definiciones';

export default function Pagina() {
  return <Catalogo def={CATALOGOS.clientes} />;
}
