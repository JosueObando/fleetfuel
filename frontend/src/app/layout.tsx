import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import '@/estilos/globals.css';

// Montserrat es la voz de cuerpo: labels, metadatos, botones, tablas.
// `display: swap` para que el texto sea legible desde el primer pintado en
// vez de quedar invisible mientras baja la fuente.
const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--fuente-montserrat',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FleetFuel Control',
  description: 'Seguimiento de flota y combustible · Alcaldía de Panamá',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-PA" className={montserrat.variable}>
      <body>{children}</body>
    </html>
  );
}
