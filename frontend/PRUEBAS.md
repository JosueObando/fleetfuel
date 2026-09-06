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
| `catalogos/Catalogo.tsx` | La pantalla que comparten los cinco catálogos: esqueletos, vacío, error, alta, edición y baja |
| Las cinco páginas de catálogo | Que cada una monte SU definición y no la del vecino |
| `catalogos/cisternas` | La suma de compartimentos en vivo, el tope de doce y el filtro de vehículos |
| `operacion/ordenes` | Que la estación dependa del cliente, y los motivos obligatorios |
| `operacion/viajes` | Que **autorizar** sea una acción aparte del §7, no una transición más |
| `app/entrar` | La puerta de MFA sin inscribir, y que un 200 no baste para entrar |
| `tablero/Tablero.tsx` | Que todo el estado de la vista viva en la URL |
| 14 componentes | Sus decisiones de accesibilidad: qué se anuncia, qué se oculta, qué se nombra |

La regla que atraviesa todo: **se prueba la conducta visible, no la
implementación.** Un rediseño que cambie colores o clases no rompe nada; uno
que borre el texto «porque el color ya lo dice» sí — y ese es el cambio que se
cuela en una revisión visual, porque en pantalla se ve perfecto.

## El umbral

| | al empezar | hoy | umbral |
|---|---|---|---|
| Sentencias | 7,24 % | **84,96 %** | 84 |
| Ramas | 6,75 % | **77,88 %** | 76 |
| Funciones | 4,65 % | **69,45 %** | 68 |
| Líneas | 7,44 % | **85,83 %** | 85 |

Sentencias y líneas pasan el 80 % de la disciplina. Lo que falta en funciones y
ramas son manejadores de la maqueta y caminos de error.

## Qué queda fuera de la medida, a propósito

`src/app/kit/**`, el kit del sistema de diseño. Es el «equivalente a Storybook»
del plan: una ruta que MUESTRA los componentes en sus estados. Cubrirla mediría
que el escaparate se renderiza, no que los componentes funcionen — y eso ya se
prueba en cada componente. Misma razón por la que el backend deja fuera los DTO
y las entidades.

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
