import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * `standalone` empaqueta el servidor con SOLO las dependencias que el
   * código alcanza de verdad, en `.next/standalone`. La imagen de producción
   * copia eso en vez de arrastrar `node_modules` entero: pasa de cientos de
   * megas a decenas, y lo que no está no se puede explotar.
   */
  output: "standalone",

  // El pie de página de Next delata la versión exacta del framework a
  // cualquiera que mire las cabeceras. No es una vulnerabilidad, pero es
  // información gratis para quien busque una versión con CVE conocido.
  poweredByHeader: false,
};

export default nextConfig;
