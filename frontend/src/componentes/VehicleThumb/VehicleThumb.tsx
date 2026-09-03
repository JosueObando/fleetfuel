import estilos from './VehicleThumb.module.css';

export type TipoVehiculo = 'cisterna' | 'camion' | 'furgoneta';

/* Siluetas de trazo, en el mismo lenguaje que Icon. Los assets definitivos
   son de marca; hasta que lleguen, estas mantienen la proporción y el hueco
   exactos para que el alto de 176 px de la tarjeta no cambie después. */
const SILUETAS: Record<TipoVehiculo, string> = {
  cisterna:  'M8 30h44a4 4 0 004-4V16a4 4 0 00-4-4H8a4 4 0 00-4 4v10a4 4 0 004 4zM56 30h12l8 8v-8M18 38a5 5 0 100-10 5 5 0 000 10zM66 38a5 5 0 100-10 5 5 0 000 10z',
  camion:    'M4 30V12h40v18M44 18h12l8 8v4H44M14 38a5 5 0 100-10 5 5 0 000 10zM56 38a5 5 0 100-10 5 5 0 000 10z',
  furgoneta: 'M6 30V16a4 4 0 014-4h30l10 10v8M16 38a5 5 0 100-10 5 5 0 000 10zM46 38a5 5 0 100-10 5 5 0 000 10z',
};

export function VehicleThumb({ tipo }: { tipo: TipoVehiculo }) {
  return (
    <div className={estilos.marco}>
      {/* Decorativa: el tipo de vehículo ya aparece en el texto de la
          tarjeta. Anunciarla otra vez sería repetición, no información. */}
      <svg
        className={estilos.silueta}
        viewBox="0 0 80 44" width="160" height="72"
        fill="none" stroke="currentColor" strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round"
        aria-hidden focusable="false"
      >
        <path d={SILUETAS[tipo]} />
      </svg>
    </div>
  );
}
