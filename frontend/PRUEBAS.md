# Pruebas del frontend

```bash
npm test           # una pasada
npm run test:watch # mientras se desarrolla
npm run test:cov   # con cobertura y umbral
```

`next/jest` aplica el mismo transformador SWC que el build, así que las pruebas
compilan el código igual que producción: JSX, alias de rutas y CSS Modules.
Configurar `ts-jest` a mano habría creado una segunda forma de compilar, y las
dos se desincronizan.

El entorno es **jsdom** y no node: lo que se prueba aquí —`localStorage`,
`fetch`, el DOM— sólo existe en un navegador, y es justo lo que falla distinto.

## Qué está cubierto hoy

| | Qué fija |
|---|---|
| `src/api/cliente.ts` | El token, la clave de idempotencia de cada POST, y qué hace con cada código de error |
| `CapacityGauge` | Los tres umbrales del spec y que el nivel se lea **sin color** |
| `StatusBadge` | Que el texto del estado esté siempre y el color sea decoración |

La regla que atraviesa las tres: **se prueba la conducta visible, no la
implementación.** Un rediseño que cambie colores o clases no las rompe; uno que
borre el texto «porque el color ya lo dice» sí — y ese es el cambio que se cuela
en una revisión visual, porque en pantalla se ve perfecto.

Y una que aplica sólo al cliente de API: un **403 no borra la sesión** y un 401
sí. Confundirlos echa al usuario de la aplicación por pulsar un botón que no le
corresponde, y volver a entrar no arregla nada.

## El umbral es un suelo, no una meta

Al ponerlo: 7,24 % de sentencias. Es un número ridículo como objetivo y sirve
para una sola cosa: que CI se queje si alguien borra las pruebas o las deja
pudrir. **Cuando la cobertura suba, súbelo.**

## Lo que falta, por orden

1. **Los 24 componentes restantes.** Los de estado (`Tabs`,
   `SegmentedControl`, `FilterChip`, `RequestList`) antes que los de puro
   dibujo.
2. **Las pantallas de catálogo** (`src/catalogos/`), que son el CRUD que usa un
   operador todos los días.
3. **`src/app/tablero/datos.ts`**, que transforma lo que llega de la API en lo
   que se pinta: si esa transformación se equivoca, el panel miente sin fallar.

## E2E

Aparte, en `e2e/`. Son recorridos con Playwright contra la aplicación en marcha,
no pruebas de componente:

```bash
node e2e/recorrido.mjs      # criterio de salida de 1A, desde la interfaz
node e2e/recorrido-1b.mjs   # orden → plan de carga → viaje
```

**No están en CI** y hay que decirlo: necesitan las librerías de sistema de
Chromium, que se instalan con `sudo npx playwright install-deps chromium`.
Mientras eso no se resuelva en el runner, son una verificación manual — se
corren a mano al cerrar una fase, y su resultado vive en el plan de
construcción, no en un check verde.
