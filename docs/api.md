# API (Backend)

Base URL local: `http://localhost:3001`

Todas las rutas (excepto `/health` y `/auth/login`) requieren:

- Header: `Authorization: Bearer <JWT>`

## Health

- `GET /health` → `{ ok: true }`

## Auth

Archivo: [routes/auth.ts](file:///e:/Prueba/ansALEJO/server/src/routes/auth.ts)

- `POST /auth/login`
  - Body: `{ "email": string, "password": string }`
  - Response: `{ "token": string }`
- `GET /auth/me`
  - Response: perfil del usuario autenticado.

## Users

Archivo: [routes/users.ts](file:///e:/Prueba/ansALEJO/server/src/routes/users.ts)

Permiso requerido: `USERS` (o rol `ADMIN`).

- `GET /users`
- `POST /users`
  - Validación: email válido, password mínimo 6, name mínimo 1.
- `PATCH /users/:id`
- `POST /users/:id/reset-password`

Errores de validación:

- `400 { error: "INVALID_BODY", details: [...] }`

## Work Orders

Archivo: [routes/workOrders.ts](file:///e:/Prueba/ansALEJO/server/src/routes/workOrders.ts)

Permiso requerido: `ORDERS` (o rol `ADMIN`).

Operaciones principales:

- `GET /work-orders`
  - Listado con filtros (estado, fechas, oportunidad, gestor, etc.).
- `POST /work-orders`
  - Crear OT manual.
- `GET /work-orders/:id`
  - Detalle + historial + novedades + cálculos.
- `PATCH /work-orders/:id`
  - Edición.
- `POST /work-orders/:id/transition`
  - Cambio de estado (ver state machine).
- Novedades:
  - `POST /work-orders/:id/novedades` (soporta upload de soporte)
  - `PATCH /work-orders/:id/novedades/:novedadId`

Endpoints utilitarios:

- `GET /work-orders/metrics`
- `GET /work-orders/gestores`
- `GET /work-orders/oportunidades`

## Cargues

Archivo: [routes/cargues.ts](file:///e:/Prueba/ansALEJO/server/src/routes/cargues.ts)

Permiso requerido: `CARGUES` (o rol `ADMIN`).

- `POST /cargues/upload`
  - `multipart/form-data`
  - Campos:
    - `file`: CSV/XLSX
    - `type`: `ACTUALIZACION | DEVOLUCIONES | CALENDARIO | ACTIVIDADES_BAREMO | RECORRIDO_INCREMENTOS`
    - `async=1` (recomendado)
    - `cleanupMissing=1` (solo donde aplique)
  - Respuesta async: `202 { jobId: string }`
- `GET /cargues/jobs/:id`
  - Devuelve estado, progreso y resultado del job.

Detalle de formatos: [docs/cargues.md](file:///e:/Prueba/ansALEJO/docs/cargues.md)

## Exports

Archivo: [routes/exports.ts](file:///e:/Prueba/ansALEJO/server/src/routes/exports.ts)

Permiso requerido: `EXPORTES` (o rol `ADMIN`).

- `GET /exports/general.csv`
- `GET /exports/orders.csv`
- `GET /exports/devoluciones.csv`
- `GET /exports/historial.csv`

## Códigos de error (estándar)

- `401 { error: "NO_AUTH" | "INVALID_TOKEN" }`
- `403 { error: "FORBIDDEN" }`
- `404 { error: "NOT_FOUND" }`
- `500 { error: "INTERNAL_ERROR" }`
