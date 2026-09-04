/*
 * Los cinco catálogos simples se describen como datos, no como cinco
 * pantallas casi iguales. La forma es idéntica —lista, formulario, alta,
 * edición y baja— y lo único que cambia son los campos.
 *
 * Cisternas NO está aquí: lleva compartimentos anidados con reglas propias
 * (la suma no puede exceder el tanque, los números no se repiten) y forzarla
 * en este molde costaría más de lo que ahorra.
 */

export interface CampoDef {
  nombre: string;
  etiqueta: string;
  tipo?: 'text' | 'email' | 'number' | 'date' | 'tel';
  requerido?: boolean;
  /** Solo al crear: no se puede cambiar después (o no tiene sentido). */
  soloAlta?: boolean;
  ayuda?: string;
  opciones?: Array<{ valor: string; etiqueta: string }>;
  /** Catálogo del que se sacan las opciones dinámicamente. */
  referencia?: { ruta: string; etiquetaCampo: string };
}

export interface CatalogoDef {
  ruta: string;
  titulo: string;
  singular: string;
  /** Columnas de la tabla, en orden. */
  columnas: Array<{ nombre: string; etiqueta: string }>;
  campos: CampoDef[];
  permisoBase: string;
}

export const CATALOGOS: Record<string, CatalogoDef> = {
  clientes: {
    ruta: '/clientes', titulo: 'Clientes', singular: 'cliente', permisoBase: 'clientes',
    columnas: [
      { nombre: 'nombre', etiqueta: 'Nombre' },
      { nombre: 'ruc', etiqueta: 'RUC' },
      { nombre: 'contacto', etiqueta: 'Contacto' },
      { nombre: 'telefono', etiqueta: 'Teléfono' },
      { nombre: 'estado', etiqueta: 'Estado' },
    ],
    campos: [
      { nombre: 'nombre', etiqueta: 'Nombre comercial', requerido: true },
      { nombre: 'razonSocial', etiqueta: 'Razón social' },
      { nombre: 'ruc', etiqueta: 'RUC', ayuda: 'Único dentro de tu operadora.' },
      { nombre: 'contacto', etiqueta: 'Persona de contacto' },
      { nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'tel' },
      { nombre: 'correo', etiqueta: 'Correo', tipo: 'email' },
    ],
  },

  productos: {
    ruta: '/productos', titulo: 'Productos', singular: 'producto', permisoBase: 'productos',
    columnas: [
      { nombre: 'codigo', etiqueta: 'Código' },
      { nombre: 'nombre', etiqueta: 'Nombre' },
      { nombre: 'unidadMedida', etiqueta: 'Unidad' },
      { nombre: 'toleranciaMerma', etiqueta: 'Merma %' },
      { nombre: 'estado', etiqueta: 'Estado' },
    ],
    campos: [
      { nombre: 'codigo', etiqueta: 'Código', requerido: true },
      { nombre: 'nombre', etiqueta: 'Nombre', requerido: true },
      { nombre: 'unidadMedida', etiqueta: 'Unidad de medida', opciones: [
        { valor: 'litros', etiqueta: 'Litros' }, { valor: 'galones', etiqueta: 'Galones' }] },
      { nombre: 'densidadReferencia', etiqueta: 'Densidad de referencia', tipo: 'number' },
      { nombre: 'toleranciaMerma', etiqueta: 'Tolerancia de merma (%)', tipo: 'number',
        ayuda: 'Entre 0 y 100.' },
      { nombre: 'colorIdentificacion', etiqueta: 'Color', ayuda: 'Para distinguirlo visualmente.' },
    ],
  },

  estaciones: {
    ruta: '/estaciones', titulo: 'Estaciones', singular: 'estación', permisoBase: 'estaciones',
    columnas: [
      { nombre: 'nombre', etiqueta: 'Nombre' },
      { nombre: 'codigoExterno', etiqueta: 'Código' },
      { nombre: 'distrito', etiqueta: 'Distrito' },
      { nombre: 'capacidadTotal', etiqueta: 'Capacidad' },
      { nombre: 'estado', etiqueta: 'Estado' },
    ],
    campos: [
      { nombre: 'clienteId', etiqueta: 'Cliente', requerido: true,
        referencia: { ruta: '/clientes', etiquetaCampo: 'nombre' } },
      { nombre: 'nombre', etiqueta: 'Nombre', requerido: true },
      { nombre: 'codigoExterno', etiqueta: 'Código externo' },
      { nombre: 'provincia', etiqueta: 'Provincia' },
      { nombre: 'distrito', etiqueta: 'Distrito' },
      { nombre: 'corregimiento', etiqueta: 'Corregimiento' },
      { nombre: 'direccion', etiqueta: 'Dirección' },
      // Latitud y longitud van juntas o no van: la API rechaza una sola.
      { nombre: 'latitud', etiqueta: 'Latitud', tipo: 'number', ayuda: 'Junto con la longitud.' },
      { nombre: 'longitud', etiqueta: 'Longitud', tipo: 'number' },
      { nombre: 'horarioRecepcion', etiqueta: 'Horario de recepción' },
      { nombre: 'contactoRecepcion', etiqueta: 'Contacto de recepción' },
      { nombre: 'capacidadTotal', etiqueta: 'Capacidad total', tipo: 'number' },
    ],
  },

  vehiculos: {
    ruta: '/vehiculos', titulo: 'Vehículos', singular: 'vehículo', permisoBase: 'vehiculos',
    columnas: [
      { nombre: 'placa', etiqueta: 'Placa' },
      { nombre: 'tipoVehiculo', etiqueta: 'Tipo' },
      { nombre: 'marca', etiqueta: 'Marca' },
      { nombre: 'modelo', etiqueta: 'Modelo' },
      { nombre: 'estadoOperativo', etiqueta: 'Estado' },
    ],
    campos: [
      { nombre: 'tipoVehiculo', etiqueta: 'Tipo', requerido: true, opciones: [
        { valor: 'cabezal', etiqueta: 'Cabezal' },
        { valor: 'cisterna', etiqueta: 'Cisterna' },
        { valor: 'integrada', etiqueta: 'Unidad integrada' }] },
      { nombre: 'placa', etiqueta: 'Placa', requerido: true },
      { nombre: 'numeroFlota', etiqueta: 'Número de flota' },
      { nombre: 'marca', etiqueta: 'Marca' },
      { nombre: 'modelo', etiqueta: 'Modelo' },
      { nombre: 'anio', etiqueta: 'Año', tipo: 'number' },
      { nombre: 'vin', etiqueta: 'VIN' },
      { nombre: 'odometroActual', etiqueta: 'Odómetro', tipo: 'number' },
      { nombre: 'gpsId', etiqueta: 'GPS' },
      { nombre: 'fechaSeguro', etiqueta: 'Vence el seguro', tipo: 'date' },
      { nombre: 'fechaRevision', etiqueta: 'Vence la revisión', tipo: 'date' },
      { nombre: 'propietario', etiqueta: 'Propietario', opciones: [
        { valor: 'propio', etiqueta: 'Propio' }, { valor: 'tercero', etiqueta: 'Tercero' }] },
    ],
  },

  conductores: {
    ruta: '/conductores', titulo: 'Conductores', singular: 'conductor', permisoBase: 'conductores',
    columnas: [
      { nombre: 'nombreCompleto', etiqueta: 'Nombre' },
      { nombre: 'documento', etiqueta: 'Documento' },
      { nombre: 'licencia', etiqueta: 'Licencia' },
      { nombre: 'fechaVencimientoLicencia', etiqueta: 'Vence' },
      { nombre: 'estado', etiqueta: 'Estado' },
    ],
    campos: [
      { nombre: 'nombreCompleto', etiqueta: 'Nombre completo', requerido: true },
      { nombre: 'documento', etiqueta: 'Documento', requerido: true },
      { nombre: 'licencia', etiqueta: 'Licencia', requerido: true },
      { nombre: 'categoria', etiqueta: 'Categoría' },
      { nombre: 'fechaVencimientoLicencia', etiqueta: 'Vence la licencia', tipo: 'date' },
      { nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'tel' },
      { nombre: 'correo', etiqueta: 'Correo', tipo: 'email' },
      { nombre: 'tarifaBase', etiqueta: 'Tarifa base', tipo: 'number' },
      { nombre: 'tarifaKm', etiqueta: 'Tarifa por km', tipo: 'number' },
      { nombre: 'tarifaViaje', etiqueta: 'Tarifa por viaje', tipo: 'number' },
      { nombre: 'tarifaEntrega', etiqueta: 'Tarifa por entrega', tipo: 'number' },
      { nombre: 'contactoEmergencia', etiqueta: 'Contacto de emergencia' },
    ],
  },
};
