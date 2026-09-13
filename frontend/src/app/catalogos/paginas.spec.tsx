import { render, screen } from '@testing-library/react';
import Clientes from './clientes/page';
import Vehiculos from './vehiculos/page';
import Conductores from './conductores/page';
import Estaciones from './estaciones/page';
import Productos from './productos/page';
import { CATALOGOS } from '@/catalogos/definiciones';

jest.mock('@/api/cliente', () => {
  const real = jest.requireActual('@/api/cliente');
  return { ...real, api: { listar: jest.fn().mockResolvedValue([]), crear: jest.fn(), actualizar: jest.fn(), desactivar: jest.fn() } };
});
const { api } = jest.requireMock('@/api/cliente') as { api: { listar: jest.Mock } };

/*
 * Las cinco pantallas simples son envoltorios de `Catalogo` con su definición.
 * Lo que se comprueba aquí no es el comportamiento —eso está en
 * `Catalogo.spec.tsx`, una vez— sino el CABLEADO: que cada página monte su
 * definición y no la del vecino.
 *
 * Suena tonto hasta que alguien copia el fichero para crear el sexto catálogo
 * y se deja el `def` del quinto: la pantalla carga, muestra una tabla y opera
 * sobre la ruta equivocada.
 */

const PAGINAS = [
  ['clientes', Clientes], ['vehiculos', Vehiculos], ['conductores', Conductores],
  ['estaciones', Estaciones], ['productos', Productos],
] as const;

beforeEach(() => { jest.clearAllMocks(); api.listar.mockResolvedValue([]); });

describe('cada página monta SU catálogo', () => {
  it.each(PAGINAS)('%s pide su propia ruta y pone su propio título', async (clave, Pagina) => {
    const def = CATALOGOS[clave];
    render(<Pagina />);
    expect(await screen.findByRole('heading', { name: def.titulo })).toBeInTheDocument();
    expect(api.listar).toHaveBeenCalledWith(def.ruta);
  });

  it('las cinco definiciones son distintas entre sí', () => {
    // Si dos compartieran ruta, una de las dos pantallas estaría operando sobre
    // el catálogo equivocado sin que nada fallara.
    const rutas = PAGINAS.map(([c]) => CATALOGOS[c].ruta);
    expect(new Set(rutas).size).toBe(rutas.length);
  });

  it('cada definición tiene columnas y campos, y la primera columna existe como campo', () => {
    // La primera columna es la que da nombre al registro en la confirmación de
    // baja y en el texto para lectores de pantalla. Si no fuera un campo real,
    // ahí saldría el id.
    for (const [clave] of PAGINAS) {
      const def = CATALOGOS[clave];
      expect({ clave, columnas: def.columnas.length > 0 }).toEqual({ clave, columnas: true });
      expect({ clave, campos: def.campos.length > 0 }).toEqual({ clave, campos: true });
      const nombres = def.campos.map(c => c.nombre);
      expect({ clave, primera: nombres.includes(def.columnas[0].nombre) })
        .toEqual({ clave, primera: true });
    }
  });

  it('los campos de referencia apuntan a rutas que existen', () => {
    // Un `referencia.ruta` mal escrito deja el desplegable vacío y en silencio:
    // la petición falla, el `.catch` la traga y el usuario ve un select sin
    // opciones sin saber por qué.
    const rutasConocidas = new Set(Object.values(CATALOGOS).map(d => d.ruta));
    for (const def of Object.values(CATALOGOS)) {
      for (const campo of def.campos) {
        if (!campo.referencia) continue;
        expect({ campo: campo.nombre, ruta: campo.referencia.ruta,
                 existe: rutasConocidas.has(campo.referencia.ruta) })
          .toEqual({ campo: campo.nombre, ruta: campo.referencia.ruta, existe: true });
      }
    }
  });
});

describe('conductores lleva además el aviso de licencias (§6.6)', () => {
  /*
   * `GET /conductores/licencias-por-vencer` existía, tenía permiso y estaba
   * declarado antes de `:id`, y aun así respondía 400 en su uso normal durante
   * meses: `ParseIntPipe({optional:true})` recibía el valor antes de poder
   * descartarlo por nulo. Se arregló el 2026-09-12 y siguió sin pantalla que lo
   * llamara — que es la segunda mitad del mismo problema: un endpoint al que
   * nadie llama está roto aunque responda 200.
   */
  it('la página pide los vencimientos además del catálogo', async () => {
    render(<Conductores />);
    await screen.findByRole('heading', { name: 'Conductores' });
    expect(api.listar).toHaveBeenCalledWith('/conductores');
    expect(api.listar).toHaveBeenCalledWith('/conductores/licencias-por-vencer?dias=30');
  });

  it('y ninguna otra página de catálogo lo hace', async () => {
    // El aviso es de conductores. Copiado en las cinco, cada pantalla haría una
    // consulta de más que además no tiene nada que ver con lo que muestra.
    render(<Clientes />);
    await screen.findByRole('heading', { name: 'Clientes' });
    expect(api.listar).not.toHaveBeenCalledWith(
      expect.stringContaining('licencias-por-vencer'));
  });
});
