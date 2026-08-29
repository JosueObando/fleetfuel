import { segundosDe } from './tokens.service';

describe('duraciones de token', () => {
  it('traduce las unidades que usa la configuración', () => {
    expect(segundosDe('15m')).toBe(900);      // access token del §7
    expect(segundosDe('7d')).toBe(604800);    // refresh del §7
    expect(segundosDe('2h')).toBe(7200);
    expect(segundosDe('30s')).toBe(30);
    expect(segundosDe('3600')).toBe(3600);
  });

  it('tolera espacios', () => {
    expect(segundosDe(' 15m ')).toBe(900);
  });

  it('revienta ante lo que no entiende en vez de suponer', () => {
    // Suponer segundos ante '15 minutos' daría un TTL de Redis absurdo y una
    // revocación que no revoca. Mejor que no arranque.
    expect(() => segundosDe('15 minutos')).toThrow(/no reconocida/);
    expect(() => segundosDe('')).toThrow();
  });
});
