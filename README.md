# FleetFuel Control — Fase 0

Sistema integral de administración de cisternas y control de combustible para la
flota de la Alcaldía de Panamá. Este repositorio es la **Fase 0** de la §19 del
expediente técnico: los cimientos que la arquitectura describe como *«las cinco
cosas más caras de añadir tarde en todo el proyecto»*.

No produce ninguna pantalla. Produce las garantías sobre las que se apoyan todas
las pantallas que vienen después.

## Qué incluye

| Cimiento | Fuente | Estado |
|---|---|---|
| Esquema multiempresa con `empresa_id` y Row Level Security | ADR 003 | ✅ |
| Autenticación JWT (acceso 15 min / refresco 7 días revocable) | §7 | ✅ |
| RBAC con permisos granulares, **sin rol de paso libre** | §7 | ✅ |
| MFA TOTP, obligatorio para Administrador, Finanzas y Auditor | §7 | ✅ |
| Interceptor global de auditoría → tabla append-only | §21, §4 | ✅ |
| Idempotencia obligatoria en todo POST, con huella del cuerpo | ADR 004 | ✅ |
| Registro y revocación remota de dispositivos | §7 | ✅ |
| Rol de base de datos sin `DELETE` sobre tablas críticas | §7, regla 14 | ✅ |
| CI con pruebas de integración contra Postgres real | §19 | ✅ |

Los 12 roles del §5 del PRD se siembran con los permisos de Fase 0 que les
corresponden. Los permisos de negocio (`viajes:despachar`, `liquidaciones:aprobar`)
llegan con sus módulos en la Fase 1.

## Las cuatro decisiones que conviene entender antes de tocar el código

**1. Dos roles de base de datos, no uno.** El dueño del esquema (`DATABASE_USER`)
corre migraciones y seeds. La aplicación se conecta con `DATABASE_APP_USER`, que
está sujeto a RLS y no tiene `DELETE`. En Postgres el dueño de una tabla evade sus
propias políticas, así que conectar la aplicación como dueño anularía el
aislamiento **sin un solo síntoma**: todo funciona y cada operadora ve los datos
de las demás. `main.ts` lo comprueba al arrancar y se niega a levantar.

**2. Una transacción por petición.** `ContextoEmpresaInterceptor` abre una
transacción y fija `app.empresa_id` con `SET LOCAL`. Tiene que ser `LOCAL`: con un
pool de conexiones, un `SET` de sesión sobrevive a la petición y la siguiente
hereda la empresa de la anterior. El efecto secundario —cada petición es
atómica— es justo lo que el dominio transaccional del §3 necesita.

**3. El login no afloja la RLS.** Para fijar el contexto hay que saber a qué
empresa pertenece el correo, pero sin contexto la RLS no deja leerlo. En vez de
conectar como dueño para el login, hay una función `SECURITY DEFINER`
(`fn_login_resolver`) que devuelve sólo lo que el login necesita. La aplicación
puede ejecutarla; no puede leer la tabla.

**4. No hay rol con paso libre.** SISOP MUPA tiene un `Administrador General` que
evade la comprobación de permisos. Aquí no, y es deliberado: el riesgo de este
negocio no es el robo de datos sino **el fraude de volumen** (§7), y la separación
entre quien captura la carga y quien captura la entrega deja de existir en cuanto
un rol puede hacerlo todo.

## Cómo correrlo

```bash
cp .env.example .env          # ajusta los secretos antes de producción
docker compose up --build
docker compose exec backend npm run seed
# API: http://localhost:4100/api
```

Sin Docker, con Postgres 16 + PostGIS y Redis propios:

```bash
cd backend
npm install
npm run migration:run   # como DUEÑO
npm run seed            # como DUEÑO
npm run start:dev       # como aplicación
```

## Pruebas

```bash
cd backend
npm run typecheck        # compilación estricta
npm test                 # unitarias — no necesitan base de datos
npm run test:integracion # RLS, append-only e idempotencia contra Postgres real
```

Las de integración **requieren un Postgres real y migrado**. Es intencional: RLS,
unicidad bajo concurrencia y los permisos de tabla son comportamiento del motor;
probarlos contra un doble es probar el doble.

## Endpoints

```
POST   /api/auth/login            público · correo, clave y codigoTotp si hay MFA
POST   /api/auth/refrescar        público · rota el refresh y revoca el anterior
POST   /api/auth/cerrar-sesion    público · revoca el refresh en Redis
GET    /api/auth/yo
POST   /api/auth/mfa/iniciar      genera el secreto TOTP (aún no habilita)
POST   /api/auth/mfa/confirmar    habilita MFA tras validar un código

GET    /api/empresa               empresas:leer
GET    /api/usuarios              usuarios:leer
POST   /api/usuarios              usuarios:crear      · exige Idempotency-Key
PATCH  /api/usuarios/:id/suspender usuarios:suspender · exige motivo

GET    /api/roles                 roles:leer
GET    /api/permisos              roles:leer
POST   /api/roles                 roles:administrar   · exige Idempotency-Key
PUT    /api/roles/:id/permisos    roles:administrar

GET    /api/dispositivos          dispositivos:leer
PATCH  /api/dispositivos/:id/revocar dispositivos:revocar · corta sesiones vivas

GET    /api/auditoria             auditoria:leer      · sólo lectura, sin escritura
```

Todo `POST` exige la cabecera `Idempotency-Key` (ADR 004). Las excepciones son
explícitas y están marcadas con `@SinIdempotencia()`: login, refresco y cierre de
sesión, donde el cliente todavía no tiene contexto de empresa donde guardarla.

## Lo siguiente (§19)

Con los cimientos puestos, el orden dentro de la Fase 1 lo fija la arquitectura:
**orden → plan de carga → viaje**, y llevar ese recorrido a producción con
usuarios reales *antes* de seguir con entregas y liquidaciones.

Ahí entran las piezas que la Fase 0 preparó pero no usa todavía: `btree_gist` para
las restricciones de exclusión del §5.1 (una cisterna o un conductor no pueden
estar en dos viajes que se superpongan) y el particionado por mes de
`posiciones_gps` del §5.2.

## Relación con SISOP MUPA

Son sistemas distintos —aquél es seguimiento de obras públicas— pero comparten
stack, y varias soluciones de aquí son su versión endurecida: RBAC sin bypass,
RLS por empresa en vez de por obra, y auditoría por interceptor en vez de por
llamada explícita.
