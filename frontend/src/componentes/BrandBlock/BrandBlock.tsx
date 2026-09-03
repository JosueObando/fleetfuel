import { Icon } from '@/componentes/Icon/Icon';
import estilos from './BrandBlock.module.css';

interface Props {
  nombre?: string;
  descriptor?: string;
  cargando?: boolean;
}

/** Ficha 1 · Marca del producto. Cabecera del sidebar. */
export function BrandBlock({
  nombre = 'FleetFuel',
  descriptor = 'Alcaldía de Panamá',
  cargando = false,
}: Props) {
  return (
    <div className={`${estilos.bloque} ${cargando ? estilos.cargando : ''}`}>
      <div className={estilos.marca}>
        {!cargando && <Icon nombre="flota" tamano={20} />}
      </div>
      <div className={estilos.textos}>
        <div className={estilos.nombre}>{cargando ? '' : nombre}</div>
        <div className={estilos.descriptor}>{cargando ? '' : descriptor}</div>
      </div>
    </div>
  );
}
