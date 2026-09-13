import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MetricStack } from './MetricStack/MetricStack';
import { RouteTimeline } from './RouteTimeline/RouteTimeline';
import { ShipmentCard } from './ShipmentCard/ShipmentCard';
import { VehicleThumb } from './VehicleThumb/VehicleThumb';
import { DetailHeader } from './DetailHeader/DetailHeader';
import { Button } from './Button/Button';
import { BrandBlock } from './BrandBlock/BrandBlock';
import { DashedCTA } from './DashedCTA/DashedCTA';
import { PanelHeader } from './PanelHeader/PanelHeader';
import { SectionHeader } from './SectionHeader/SectionHeader';
import { IconToolbar } from './IconToolbar/IconToolbar';
import { ActionTile } from './ActionTile/ActionTile';
import { Icon } from './Icon/Icon';

/*
 * Los componentes de presentación del panel.
 *
 * No se prueba «que se rendericen»: eso no es una prueba, es una comprobación
 * de que TypeScript compila. Se prueban las decisiones que están escritas en
 * cada uno y que un rediseño puede tirar sin que se note mirando la pantalla,
 * casi todas de accesibilidad: qué se anuncia, qué se oculta y qué se nombra.
 */

describe('MetricStack · el tiempo restante', () => {
  it('formatea a hh:mm:ss', () => {
    render(<MetricStack segundosRestantes={4521} km={18.4} />);
    expect(screen.getByText('01:15:21')).toBeInTheDocument();
  });

  it('se anuncia como temporizador, no como texto fijo', () => {
    // Sin `role=timer` el lector lo lee una vez y nunca más: la persona oiría
    // el valor del momento en que entró y lo daría por vigente.
    render(<MetricStack segundosRestantes={4521} km={18.4} />);
    expect(screen.getByRole('timer')).toHaveAccessibleName(/01:15:21/);
  });

  it('no cuenta hacia atrás por debajo de cero', () => {
    // Un viaje entregado tiene 0; un reloj negativo diría «-00:00:05» y
    // parecería un error del sistema.
    render(<MetricStack segundosRestantes={-30} km={0} />);
    expect(screen.getByText('00:00:00')).toBeInTheDocument();
  });

  it('la distancia lleva siempre un decimal', () => {
    render(<MetricStack segundosRestantes={0} km={18} />);
    expect(screen.getByText('18.0 km')).toBeInTheDocument();
  });
});

describe('RouteTimeline · las paradas', () => {
  const PARADAS = [
    { etiqueta: 'Planta', fase: 'pasada' as const },
    { etiqueta: 'Vía Ricardo J. Alfaro', fase: 'actual' as const },
    { etiqueta: 'Tocumen', fase: 'futura' as const },
  ];

  it('es una lista ordenada, porque el orden ES el dato', () => {
    render(<RouteTimeline paradas={PARADAS} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('la fase se dice con TEXTO, no sólo con color y grosor', () => {
    // Color y peso son invisibles para un lector de pantalla, y «dónde va el
    // camión ahora» es justo lo que se quiere saber.
    render(<RouteTimeline paradas={PARADAS} />);
    const filas = screen.getAllByRole('listitem');
    const actual = filas.find(f => f.textContent?.includes('Vía Ricardo J. Alfaro'));
    expect(actual?.textContent).toMatch(/actual/i);
  });

  it('el punto decorativo no se anuncia', () => {
    const { container } = render(<RouteTimeline paradas={PARADAS} />);
    expect(container.querySelectorAll('[aria-hidden]').length).toBeGreaterThan(0);
  });

  it('una ruta larga se recorta en vez de romper la tarjeta', () => {
    const muchas = Array.from({ length: 12 }, (_, i) => ({
      etiqueta: `Parada ${i}`, fase: 'futura' as const }));
    render(<RouteTimeline paradas={muchas} />);
    expect(screen.getAllByRole('listitem').length).toBeLessThan(muchas.length);
  });
});

describe('ShipmentCard · la tarjeta de envío', () => {
  const base = {
    identificador: 'SD-4821-PTY', estado: 'enRuta' as const,
    segundosRestantes: 4521, km: 18.4, vehiculo: 'cisterna' as const,
    paradas: [{ etiqueta: 'Planta', fase: 'actual' as const }],
  };

  it('es un botón: se puede activar con teclado', () => {
    // Una tarjeta hecha con `div onClick` no recibe foco ni responde a Enter, y
    // el panel entero deja de ser navegable sin ratón.
    render(<ShipmentCard {...base} />);
    expect(screen.getByRole('button', { name: /SD-4821-PTY/ })).toBeInTheDocument();
  });

  it('avisa al pulsarla', async () => {
    const usuario = userEvent.setup();
    const onClick = jest.fn();
    render(<ShipmentCard {...base} onClick={onClick} />);
    await usuario.click(screen.getByRole('button', { name: /SD-4821-PTY/ }));
    expect(onClick).toHaveBeenCalled();
  });

  it('deshabilitada o cargando no responde', async () => {
    const usuario = userEvent.setup();
    const onClick = jest.fn();
    const { rerender } = render(<ShipmentCard {...base} deshabilitado onClick={onClick} />);
    await usuario.click(screen.getByRole('button'));
    rerender(<ShipmentCard {...base} cargando onClick={onClick} />);
    await usuario.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('muestra el estado en palabras, no sólo con color', () => {
    render(<ShipmentCard {...base} estado="retrasado" />);
    expect(screen.getByText('Retrasado')).toBeInTheDocument();
  });
});

describe('VehicleThumb · la silueta', () => {
  it('es decorativa y no se anuncia', () => {
    // El tipo de vehículo ya aparece en el texto de la tarjeta: anunciarlo otra
    // vez sería repetición, no información.
    const { container } = render(<VehicleThumb tipo="cisterna" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it('cada tipo dibuja una silueta distinta', () => {
    const { container: a } = render(<VehicleThumb tipo="cisterna" />);
    const { container: b } = render(<VehicleThumb tipo="furgoneta" />);
    expect(a.querySelector('path')?.getAttribute('d'))
      .not.toBe(b.querySelector('path')?.getAttribute('d'));
  });
});

describe('DetailHeader · la cabecera del detalle', () => {
  it('el identificador es una cabecera de verdad', () => {
    render(<DetailHeader identificador="SD-4821-PTY" estado="enRuta" />);
    expect(screen.getByRole('heading', { name: 'SD-4821-PTY' })).toBeInTheDocument();
  });

  it('sin envío seleccionado, las acciones no se pueden pulsar', () => {
    render(<DetailHeader identificador="—" estado="esperando" deshabilitado />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });
});

describe('Button · estados', () => {
  it('cargando no dispara el click', async () => {
    const usuario = userEvent.setup();
    const onClick = jest.fn();
    render(<Button cargando onClick={onClick}>Guardar</Button>);
    await usuario.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('el texto sigue estando mientras carga', () => {
    // Sustituirlo por un spinner hace que el botón cambie de tamaño y que el
    // lector de pantalla pierda de qué botón se trata.
    render(<Button cargando>Guardar</Button>);
    expect(screen.getByRole('button')).toHaveAccessibleName(/Guardar/);
  });

  it('por defecto NO es submit', () => {
    // Un botón dentro de un formulario sin `type` envía el formulario. Los de
    // «Cancelar» y «Quitar» viven dentro de formularios.
    render(<Button>Cancelar</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});

describe('los bloques de chrome', () => {
  it('BrandBlock enseña la marca', () => {
    render(<BrandBlock />);
    expect(screen.getByText(/FleetFuel/i)).toBeInTheDocument();
  });

  it('DashedCTA es accionable y dice qué hace', async () => {
    const usuario = userEvent.setup();
    const onClick = jest.fn();
    render(<DashedCTA etiqueta="Añadir envío" onClick={onClick} />);
    await usuario.click(screen.getByRole('button', { name: /Añadir envío/ }));
    expect(onClick).toHaveBeenCalled();
  });

  it('DashedCTA cargando no dispara', async () => {
    const usuario = userEvent.setup();
    const onClick = jest.fn();
    render(<DashedCTA etiqueta="Añadir envío" cargando onClick={onClick} />);
    await usuario.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('PanelHeader y SectionHeader ponen encabezados reales', () => {
    // Por ROL y no por texto: buscando «Envíos» la prueba seguía en verde con
    // el <h2> cambiado por un <div>, y quien navega por encabezados perdía el
    // panel entero.
    render(<><PanelHeader titulo="Envíos" /><SectionHeader titulo="Hoy" /></>);
    expect(screen.getByRole('heading', { name: 'Envíos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hoy' })).toBeInTheDocument();
  });

  it('PanelHeader cargando no deja buscar en lo que aún no ha llegado', () => {
    // El título se vacía para el esqueleto, pero el botón conserva su nombre:
    // un botón deshabilitado y SIN nombre no dice qué es ni por qué no responde.
    render(<PanelHeader titulo="Envíos" cargando />);
    expect(screen.queryByText('Envíos')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar en Envíos' })).toBeDisabled();
  });

  it('BrandBlock cargando es sólo el esqueleto: ni icono ni textos a medias', () => {
    const { container } = render(<BrandBlock cargando />);
    expect(screen.queryByText(/FleetFuel/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Control de flota/)).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('IconToolbar da nombre accesible a cada icono', () => {
    // Un botón que sólo contiene un icono no tiene texto: sin `aria-label` el
    // lector de pantalla anuncia «botón» y nada más.
    render(<IconToolbar utilidades={[
      { icono: 'buscar', titulo: 'Buscar' },
      { icono: 'ajustes', titulo: 'Filtrar', activo: true },
    ]} />);
    expect(screen.getByRole('toolbar', { name: 'Utilidades' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeInTheDocument();
    // `aria-pressed` porque son interruptores, no navegación.
    expect(screen.getByRole('button', { name: 'Filtrar' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('IconToolbar cargando deshabilita todo', () => {
    render(<IconToolbar cargando utilidades={[{ icono: 'buscar', titulo: 'Buscar' }]} />);
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeDisabled();
  });

  it('ActionTile se anuncia con su etiqueta', () => {
    render(<ActionTile etiqueta="Pedir foto" />);
    expect(screen.getByRole('button', { name: /Pedir foto/ })).toBeInTheDocument();
  });
});

describe('Icon · decorativo o con significado', () => {
  /* La mayoría de los iconos van junto a un texto que ya dice lo mismo, y
     anunciarlos sería ruido. Pero un icono SOLO —un estado, un aviso— es
     información, y oculto deja a quien usa lector de pantalla sin ella. La
     frontera la marca `titulo`, y lo que se fija aquí es que no se cruce. */
  it('sin título se oculta y no se anuncia como imagen', () => {
    const { container } = render(<Icon nombre="buscar" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('con título es una imagen con nombre, y no está oculta', () => {
    render(<Icon nombre="campana" titulo="Retrasado" />);
    const img = screen.getByRole('img', { name: 'Retrasado' });
    expect(img).not.toHaveAttribute('aria-hidden');
  });

  it('mide 20 px si nadie dice otra cosa, que es el tamaño de la navegación', () => {
    const { container } = render(<Icon nombre="buscar" />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '20');
  });
});
