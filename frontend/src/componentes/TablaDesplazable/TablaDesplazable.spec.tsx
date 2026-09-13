import { render, screen } from '@testing-library/react';
import { TablaDesplazable } from './TablaDesplazable';

/*
 * El envoltorio que impide que una tabla ancha rompa la página.
 *
 * POR QUÉ EXISTE
 *
 * La sonda de los 5 breakpoints (`e2e/sonda-responsive.mjs`) encontró SEIS
 * combinaciones con scroll horizontal en el documento entero: las tres tablas
 * de catálogo por debajo de 768 px, y la de usuarios —siete columnas— saliéndose
 * ya a 1100 px, que es un portátil corriente.
 *
 * Una tabla no se puede estrechar sin volverse ilegible, así que la salida no
 * es apretar columnas: es que **scrollee la tabla y no la página**. Es la única
 * excepción a «el cuerpo nunca scrollea en horizontal».
 *
 * LO QUE SE PRUEBA AQUÍ, Y LO QUE NO
 *
 * El comportamiento visual —que efectivamente no se salga— no es verificable en
 * jsdom: no calcula layout ni tiene ancho. Eso lo comprueba la sonda, en un
 * navegador de verdad. Aquí se fija lo que jsdom SÍ ve y es lo que se rompe al
 * copiar el patrón a mano: que la caja con scroll sea **alcanzable por
 * teclado**.
 */
describe('la caja con scroll', () => {
  it('es alcanzable por teclado', () => {
    /* Una región que scrollea y NO puede recibir el foco es contenido al que
       sólo se llega con un ratón: quien navega con teclado no tiene forma de
       desplazarla, y las columnas de la derecha dejan de existir para él.
       Es el fallo de accesibilidad clásico de este patrón, y el motivo de que
       esto sea un componente y no un `div` copiado cinco veces. */
    render(<TablaDesplazable etiqueta="Usuarios"><table><tbody /></table></TablaDesplazable>);
    expect(screen.getByRole('region', { name: 'Usuarios' })).toHaveAttribute('tabindex', '0');
  });

  it('se anuncia con el nombre de lo que contiene', () => {
    // «Región» a secas no dice nada. Con el nombre, quien salta entre regiones
    // sabe si esta es la que busca antes de entrar.
    render(<TablaDesplazable etiqueta="Auditoría"><table><tbody /></table></TablaDesplazable>);
    expect(screen.getByRole('region', { name: 'Auditoría' })).toBeInTheDocument();
  });

  it('pinta dentro lo que se le dé', () => {
    render(
      <TablaDesplazable etiqueta="X">
        <table><tbody><tr><td>una celda</td></tr></tbody></table>
      </TablaDesplazable>);
    expect(screen.getByText('una celda')).toBeInTheDocument();
  });
});
