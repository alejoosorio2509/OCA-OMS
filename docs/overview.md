# Overview (Código Fuente)

## Objetivo del sistema

OCA-OMS centraliza la gestión operativa de órdenes de trabajo (OT) con:

- Autenticación por JWT y control de permisos por usuario.
- Registro de estados, fechas operativas y métricas (días de gestión, días pasados, cumplimiento).
- Cargues masivos (CSV/XLSX) para actualizar datos operativos: actualizaciones, devoluciones, calendario, actividades baremo y recorrido de incrementos.
- Exportes CSV para análisis externo.

## Arquitectura

- Web (Vite/React) consume la API con `Authorization: Bearer <token>`.
- API (Express) implementa lógica de negocio, cálculos y endpoints.
- DB (PostgreSQL) almacena entidades y soporta jobs persistentes de cargues.

Componentes:

- Frontend: [web](file:///e:/Prueba/ansALEJO/web)
- Backend: [server](file:///e:/Prueba/ansALEJO/server)
- Prisma schema: [schema.prisma](file:///e:/Prueba/ansALEJO/server/prisma/schema.prisma)

## Flujo de autenticación y permisos

1) `POST /auth/login` valida credenciales y retorna un JWT (8h).
2) Web guarda el token y lo manda en cada request.
3) La API valida el token (`requireAuth`) y consulta flags de permisos (`requirePermission`).

Código:

- JWT + middleware: [auth.ts](file:///e:/Prueba/ansALEJO/server/src/auth.ts)
- Endpoints de auth: [auth.ts (router)](file:///e:/Prueba/ansALEJO/server/src/routes/auth.ts)

Permisos disponibles:

- `ORDERS`, `CARGUES`, `EXPORTES`, `USERS`

## Módulos principales (backend)

- Bootstrap Express + CORS + routers: [index.ts](file:///e:/Prueba/ansALEJO/server/src/index.ts)
- Prisma client singleton: [prisma.ts](file:///e:/Prueba/ansALEJO/server/src/prisma.ts)
- Rutas:
  - Auth: [routes/auth.ts](file:///e:/Prueba/ansALEJO/server/src/routes/auth.ts)
  - Usuarios: [routes/users.ts](file:///e:/Prueba/ansALEJO/server/src/routes/users.ts)
  - Órdenes: [routes/workOrders.ts](file:///e:/Prueba/ansALEJO/server/src/routes/workOrders.ts)
  - Cargues: [routes/cargues.ts](file:///e:/Prueba/ansALEJO/server/src/routes/cargues.ts)
  - Exportes: [routes/exports.ts](file:///e:/Prueba/ansALEJO/server/src/routes/exports.ts)

## Módulos principales (frontend)

- Router y protección de rutas: [App.tsx](file:///e:/Prueba/ansALEJO/web/src/App.tsx), [RequireAuth.tsx](file:///e:/Prueba/ansALEJO/web/src/RequireAuth.tsx)
- Cliente API: [api.ts](file:///e:/Prueba/ansALEJO/web/src/api.ts)
- Páginas:
  - Órdenes: [OrdersPage.tsx](file:///e:/Prueba/ansALEJO/web/src/pages/OrdersPage.tsx)
  - Detalle: [OrderDetailsPage.tsx](file:///e:/Prueba/ansALEJO/web/src/pages/OrderDetailsPage.tsx)
  - Cargues: [CarguesPage.tsx](file:///e:/Prueba/ansALEJO/web/src/pages/CarguesPage.tsx)
  - Usuarios: [UsersPage.tsx](file:///e:/Prueba/ansALEJO/web/src/pages/UsersPage.tsx)
  - Exportes: [ExportesPage.tsx](file:///e:/Prueba/ansALEJO/web/src/pages/ExportesPage.tsx)

## Convenciones importantes

- La lógica de “días” se calcula con `Calendar` (Inicio/Fin) y debe estar consistente en zona horaria Colombia. El cargue de calendario normaliza fechas para evitar desfases.
- Los cargues grandes se procesan en segundo plano con jobs persistentes (`CargueJob`) y polling desde el frontend.
