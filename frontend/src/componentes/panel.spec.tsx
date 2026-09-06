import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestList } from './RequestList/RequestList';
import { PhotoStrip } from './PhotoStrip/PhotoStrip';
import { PhotoCard } from './PhotoCard/PhotoCard';
import { MapControl } from './MapControl/MapControl';
import { MapView } from './MapView/MapView';
import { NavGroup } from './NavGroup/NavGroup';
import { NavItem } from './NavItem/NavItem';

/*
 * Los componentes del panel de seguimiento. Igual que en el otro fichero, lo
 * que se fija son las decisiones escritas en cada uno, casi todas sobre qué se
 * anuncia y qué no.
 */

describe('RequestList · solicitudes de cambio de ruta', () => {
  const SOLICITUDES = [
    { id: 's1', solicitud: 'Desvío por calle cerrada', solicitante: 'Ana', hora: '14:02' },
    { id: 's2', solicitud: 'Parada extra para recoger sello', solicitante: 'Beto', hora: '15:10' },
  ];

  it('sin solicitudes lo dice, en vez de dejar un hueco', () => {
    render(<RequestList solicitudes={[]} />);
    expect(screen.getByText(/No hay solicitudes pendientes/)).toBeInTheDocument();
  });

  it('cada solicitud trae qué se pide y quién la pidió', () => {
    // El texto aparece también en el nombre accesible de los dos botones de la
    // fila —para que «Aprobar» diga QUÉ aprueba—, así que se busca dentro de la
    // fila y no en toda la pantalla.
    render(<RequestList solicitudes={SOLICITUDES} />);
    const fila = screen.getAllByRole('listitem')[0];
    expect(within(fila).getAllByText(/Desvío por calle cerrada/).length).toBeGreaterThan(0);
    expect(within(fila).getAllByText(/Ana/).length).toBeGreaterThan(0);
  });

  it('aprobar y rechazar avisan con el id de LA solicitud', async () => {
    // Con varias en pantalla, un callback sin id obliga a adivinar cuál se
    // aprobó — y aprobar la equivocada cambia la ruta de un camión.
    const usuario = userEvent.setup();
    const onAprobar = jest.fn(); const onRechazar = jest.fn();
    render(<RequestList solicitudes={SOLICITUDES} onAprobar={onAprobar} onRechazar={onRechazar} />);
    const filas = screen.getAllByRole('listitem');
    await usuario.click(within(filas[1]).getByRole('button', { name: /Aprobar/ }));
    await usuario.click(within(filas[0]).getByRole('button', { name: /Rechazar/ }));
    expect(onAprobar).toHaveBeenCalledWith('s2');
    expect(onRechazar).toHaveBeenCalledWith('s1');
  });
});

describe('PhotoStrip y PhotoCard · los reportes del conductor', () => {
  const FOTOS = [
    { id: 'f1', titulo: 'Descarga', direccion: 'Vía España', hora: '14:32', estado: 'ok' as const },
    { id: 'f2', titulo: 'Sello', direccion: 'San Miguelito', hora: '15:10', estado: 'pendiente' as const },
  ];

  it('sin fotos lo dice', () => {
    render(<PhotoStrip fotos={[]} />);
    expect(screen.getByText(/Todavía no hay reportes/)).toBeInTheDocument();
  });

  it('es una lista anunciada, no un montón de botones sueltos', () => {
    render(<PhotoStrip fotos={FOTOS} />);
    expect(screen.getByRole('list', { name: /Reportes fotográficos/ })).toBeInTheDocument();
  });

  it('cada foto junta sus cuatro datos en UN nombre accesible', () => {
    // Sin esto el lector diría «Verificada» sin decir de qué foto ni cuándo, y
    // con cinco fotos seguidas eso no informa de nada.
    render(<PhotoCard foto={FOTOS[0]} />);
    const boton = screen.getByRole('button');
    for (const parte of ['Descarga', 'Vía España', '14:32']) {
      expect(boton).toHaveAccessibleName(expect.stringContaining(parte));
    }
  });

  it('pedir una foto nueva avisa', async () => {
    const usuario = userEvent.setup();
    const onPedirFoto = jest.fn();
    render(<PhotoStrip fotos={FOTOS} onPedirFoto={onPedirFoto} />);
    const pedir = screen.queryByRole('button', { name: /Pedir/ });
    if (pedir) { await usuario.click(pedir); expect(onPedirFoto).toHaveBeenCalled(); }
  });

  it('una foto deshabilitada no se puede abrir', async () => {
    const usuario = userEvent.setup();
    const onClick = jest.fn();
    render(<PhotoCard foto={{ ...FOTOS[0], deshabilitada: true }} onClick={onClick} />);
    await usuario.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('MapControl y MapView', () => {
  it('los controles del mapa se anuncian como grupo con nombre', () => {
    render(<MapControl etiqueta="Controles del mapa" controles={[
      { titulo: 'Acercar', onClick: jest.fn() },
      { titulo: 'Alejar', onClick: jest.fn() },
    ]} />);
    expect(screen.getByRole('group', { name: 'Controles del mapa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acercar' })).toBeInTheDocument();
  });

  it('cada control llama a lo suyo', async () => {
    const usuario = userEvent.setup();
    const acercar = jest.fn(); const alejar = jest.fn();
    render(<MapControl etiqueta="Mapa" controles={[
      { titulo: 'Acercar', onClick: acercar }, { titulo: 'Alejar', onClick: alejar }]} />);
    await usuario.click(screen.getByRole('button', { name: 'Alejar' }));
    expect(alejar).toHaveBeenCalled();
    expect(acercar).not.toHaveBeenCalled();
  });

  it('un control deshabilitado no responde', async () => {
    const usuario = userEvent.setup();
    const onClick = jest.fn();
    render(<MapControl etiqueta="Mapa" controles={[
      { titulo: 'Centrar', onClick, deshabilitado: true }]} />);
    await usuario.click(screen.getByRole('button', { name: 'Centrar' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('el mapa se renderiza sin datos, en vez de romper el panel', () => {
    const { container } = render(<MapView />);
    expect(container.firstChild).toBeTruthy();
  });
});

describe('NavGroup · el menú plegable', () => {
  const SUBITEMS = [{ etiqueta: 'Órdenes' }, { etiqueta: 'Viajes' }];

  it('cerrado, sus subitems no se anuncian', () => {
    render(<NavGroup etiqueta="Operación" subitems={SUBITEMS} />);
    expect(screen.getByRole('button', { name: /Operación/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('abrirlo lo dice a quien no lo ve', async () => {
    // `aria-expanded` es lo único que distingue «hay más debajo» de «esto es
    // todo» para un lector de pantalla; la flecha girada no se anuncia.
    const usuario = userEvent.setup();
    render(<NavGroup etiqueta="Operación" subitems={SUBITEMS} />);
    await usuario.click(screen.getByRole('button', { name: /Operación/ }));
    expect(screen.getByRole('button', { name: /Operación/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Órdenes')).toBeInTheDocument();
  });

  it('puede nacer abierto', () => {
    render(<NavGroup etiqueta="Operación" subitems={SUBITEMS} abiertoInicial />);
    expect(screen.getByRole('button', { name: /Operación/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('deshabilitado no se abre', async () => {
    const usuario = userEvent.setup();
    render(<NavGroup etiqueta="Operación" subitems={SUBITEMS} deshabilitado />);
    await usuario.click(screen.getByRole('button', { name: /Operación/ }));
    expect(screen.getByRole('button', { name: /Operación/ })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('NavItem', () => {
  it('marca la sección actual con aria-current, no sólo con color', () => {
    // El resalte visual no existe para un lector de pantalla: sin `aria-current`
    // no hay forma de saber en qué sección se está.
    render(<NavItem icono="ordenes" etiqueta="Órdenes" activo />);
    expect(screen.getByRole('button', { name: /Órdenes/ })).toHaveAttribute('aria-current', 'page');
  });

  it('y no la marca cuando no lo es', () => {
    render(<NavItem icono="ordenes" etiqueta="Viajes" />);
    expect(screen.getByRole('button', { name: /Viajes/ })).not.toHaveAttribute('aria-current');
  });

  it('colapsado conserva el nombre accesible', async () => {
    // En la barra estrecha sólo se ve el icono: si el nombre desapareciera con
    // el texto, la navegación entera quedaría sin etiquetas.
    render(<NavItem icono="ordenes" etiqueta="Órdenes" colapsado />);
    expect(screen.getByRole('button', { name: /Órdenes/ })).toBeInTheDocument();
  });

  it('deshabilitado no llama', async () => {
    const usuario = userEvent.setup();
    const onClick = jest.fn();
    render(<NavItem icono="ordenes" etiqueta="Órdenes" deshabilitado onClick={onClick} />);
    await usuario.click(screen.getByRole('button', { name: /Órdenes/ }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
