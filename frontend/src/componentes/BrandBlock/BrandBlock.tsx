import { Icon } from '@/componentes/Icon/Icon';
import estilos from './BrandBlock.module.css';

interface Props {
  nombre?: string;
  descriptor?: string;
  cargando?: boolean;
  /** 1024-1279: solo el círculo de marca. */
  soloMarca?: boolean;
}

/** Ficha 1 · Marca del producto. Cabecera del sidebar. */
export function BrandBlock({
  nombre = 'FleetFuel',
  descriptor = 'Control de flota y combustible',
  cargando = false,
  soloMarca = false,
}: Props) {
  return (
    <div className={[estilos.bloque, cargando && estilos.cargando, soloMarca && estilos.soloMarca].filter(Boolean).join(' ')}>
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
