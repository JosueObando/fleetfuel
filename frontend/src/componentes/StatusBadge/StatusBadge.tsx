import estilos from './StatusBadge.module.css';

export type EstadoEnvio = 'enRuta' | 'esperando' | 'retrasado' | 'entregado';

/* Copy en español de Panamá. El label NO es decorativo: es lo que hace que el
   estado sea legible sin depender del color, requisito del spec de
   accesibilidad. Por eso el punto es aria-hidden y el texto siempre está. */
const ETIQUETAS: Record<EstadoEnvio, string> = {
  enRuta: 'En ruta',
  esperando: 'Esperando',
  retrasado: 'Retrasado',
  entregado: 'Entregado',
};

export function StatusBadge({ estado }: { estado: EstadoEnvio }) {
  return (
    <span className={`${estilos.insignia} ${estilos[estado]}`}>
      <span className={estilos.punto} aria-hidden />
      <span className={estilos.texto}>{ETIQUETAS[estado]}</span>
    </span>
  );
}
