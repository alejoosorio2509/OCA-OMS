# Manual de Desarrollo (OCA-OMS)

Este documento describe cómo está planteado, construido y operado el sistema **OCA-OMS** (frontend + backend + base de datos), con énfasis en decisiones técnicas, flujo de datos, patrones reutilizables y forma de ejecutar/desplegar.

## 1) Objetivo del sistema

OCA-OMS es un sistema web con **autenticación y permisos** para:

- Consultar y dar seguimiento a Órdenes de Trabajo (OT) y sus métricas (ANS, cumplimiento, descuentos, novedades).
- Gestionar **cargues masivos** (archivos) que alimentan tablas operativas.
- Exportar información en formatos CSV/TXT.
- Soportar módulos operativos como **Actualización**, **Levantamiento**, **Sol. CDS Nuevos** y **Componentes AT**.

## 2) Arquitectura (alto nivel)

Arquitectura típica en producción:

- **Web (React + Vite)**: entrega UI y consume la API.
- **API (Node.js + Express + TypeScript)**: valida permisos, aplica reglas de negocio y consulta/persiste datos.
- **PostgreSQL (Supabase)**: almacena entidades principales (WorkOrder, Levantamiento, Calendar, etc).

Referencia general: [README.md](file:///e:/Prueba/ansALEJO/README.md).

## 3) Estructura del repositorio

- Backend (API): [server](file:///e:/Prueba/ansALEJO/server)
  - Rutas/endpoints: [server/src/routes](file:///e:/Prueba/ansALEJO/server/src/routes)
  - Prisma schema (modelo de datos): [server/prisma/schema.prisma](file:///e:/Prueba/ansALEJO/server/prisma/schema.prisma)
  - Inicialización/servidor: [server/src/index.ts](file:///e:/Prueba/ansALEJO/server/src/index.ts)
- Frontend (Web): [web](file:///e:/Prueba/ansALEJO/web)
  - Páginas principales: [web/src/pages](file:///e:/Prueba/ansALEJO/web/src/pages)
  - Cliente API: [web/src/api.ts](file:///e:/Prueba/ansALEJO/web/src/api.ts)
  - Estilos globales: [web/src/index.css](file:///e:/Prueba/ansALEJO/web/src/index.css), [web/src/layout.css](file:///e:/Prueba/ansALEJO/web/src/layout.css)

## 4) Stack y convenciones

### Backend

- Express + TypeScript.
- Prisma como ORM.
- Validación de entradas con Zod.
- Autenticación/permiso por middleware.

Patrón típico por endpoint:

1. `requireAuth` para exigir sesión.
2. `requirePermission("<PERMISO>")` para autorizar.
3. `z.object({...}).safeParse(req.query|req.body)` para validar.
4. Construcción de `where` (Prisma) y/o cálculo adicional con calendario.
5. Respuesta JSON consistente.

Ejemplo de router: [levantamientos.ts](file:///e:/Prueba/ansALEJO/server/src/routes/levantamientos.ts).

### Frontend

- React + TypeScript.
- Fetch centralizado en `apiFetch` y funciones específicas por módulo.
- Patrón de filtros “**draft vs applied**”:
  - Los inputs modifican `draft...`.
  - Botón **Buscar** copia a `applied`.
  - El `useEffect` de carga usa `applied` para llamar la API.

Ejemplos:
- Actualización (OT): [OrdersPage.tsx](file:///e:/Prueba/ansALEJO/web/src/pages/OrdersPage.tsx)
- Componentes AT: [ComponentesAtPage.tsx](file:///e:/Prueba/ansALEJO/web/src/pages/ComponentesAtPage.tsx)
- Levantamiento: [LevantamientoPage.tsx](file:///e:/Prueba/ansALEJO/web/src/pages/LevantamientoPage.tsx)

## 5) Autenticación y permisos

El sistema se basa en JWT y flags por usuario/rol.

- Middleware: `requireAuth`, `requirePermission(...)` en [server/src/auth.ts](file:///e:/Prueba/ansALEJO/server/src/auth.ts)
- Rutas de auth: [server/src/routes/auth.ts](file:///e:/Prueba/ansALEJO/server/src/routes/auth.ts)
- En frontend el token se guarda y se adjunta en cada request: [web/src/auth.tsx](file:///e:/Prueba/ansALEJO/web/src/auth.tsx), [web/src/api.ts](file:///e:/Prueba/ansALEJO/web/src/api.ts)

## 6) Base de datos y modelo (Prisma)

Los modelos están en Prisma y se generan clientes tipados.

- Schema: [schema.prisma](file:///e:/Prueba/ansALEJO/server/prisma/schema.prisma)
- Cliente Prisma: [server/src/prisma.ts](file:///e:/Prueba/ansALEJO/server/src/prisma.ts)

Conceptos importantes:

- **Calendar**: tabla crítica para convertir fechas a numeración de “días” (Inicio/Fin) usada por ANS.
- **WorkOrder**: OT y sus campos operativos (estado, assignedAt, gestionAt, ANS, descuentos, etc).
- **Levantamiento**: dataset del módulo de levantamiento (estado/subestado, fechas, cuadrilla, etc).

## 7) Calendario y cálculo de días (Inicio/Fin)

Gran parte de la lógica de ANS depende de mapear fechas a números de día:

- `inicioMap`: `YYYY-MM-DD -> dayNumber`
- `finMap`: `YYYY-MM-DD -> dayNumberFin` (fallback `dayNumber`)

Esto permite calcular vencimientos y diferencias con reglas operativas.

Ejemplo de cálculo con calendario en Levantamiento:
- [levantamientos.ts](file:///e:/Prueba/ansALEJO/server/src/routes/levantamientos.ts#L520-L596)

## 8) Cargues (ingesta de archivos)

El módulo de cargues procesa archivos (CSV/XLSX) para alimentar tablas.

- Ruta de cargues: [server/src/routes/cargues.ts](file:///e:/Prueba/ansALEJO/server/src/routes/cargues.ts)
- UI de cargues: [CarguesPage.tsx](file:///e:/Prueba/ansALEJO/web/src/pages/CarguesPage.tsx)

Convenciones:

- Normalización de headers (mayúsculas/minúsculas, espacios).
- Parse robusto de fechas y textos.
- Al finalizar, persistir de forma consistente para que el módulo consumidor quede alimentado.

## 9) Módulos principales y cómo están implementados

### 9.1) Actualización (Órdenes de trabajo)

**Objetivo:** listar OTs, mostrar métricas y permitir export.

Frontend:
- Página: [OrdersPage.tsx](file:///e:/Prueba/ansALEJO/web/src/pages/OrdersPage.tsx)
- Badges/estilos de estado: [layout.css](file:///e:/Prueba/ansALEJO/web/src/layout.css#L223-L309)

Backend:
- Listado: [workOrders.ts](file:///e:/Prueba/ansALEJO/server/src/routes/workOrders.ts)
- Export: [exports.ts](file:///e:/Prueba/ansALEJO/server/src/routes/exports.ts)

Regla clave (evitar discrepancias de rango de fechas):
- Cuando se filtra por `dateEnd`, se normaliza a fin del día para alinear listado/métricas/export.

### 9.2) Levantamiento

**Objetivo:** listar levantamientos con cálculo de SLA por etapas, métricas y export.

Frontend:
- Página: [LevantamientoPage.tsx](file:///e:/Prueba/ansALEJO/web/src/pages/LevantamientoPage.tsx)

Backend:
- Listado/metrics: [levantamientos.ts](file:///e:/Prueba/ansALEJO/server/src/routes/levantamientos.ts)
- Export: [exports.ts](file:///e:/Prueba/ansALEJO/server/src/routes/exports.ts#L672-L760)

Características implementadas:

- Columna **Cuadrilla** (asignada) en tabla.
- “Botones” de **Estados** estilo chip/badge (igual a Actualización) para filtrar.
- Cálculo de recorridos ENEL como `diasEnel` (unión de intervalos): [levantamientos.ts](file:///e:/Prueba/ansALEJO/server/src/routes/levantamientos.ts#L57-L76)

### 9.3) Sol. CDS Nuevos

**Objetivo:** formulario con catálogos grandes (autocomplete) y validación en frontend + backend.

- Frontend: [SolCdsNuevosPage.tsx](file:///e:/Prueba/ansALEJO/web/src/pages/SolCdsNuevosPage.tsx)
- Backend: [solCdsNuevos.ts](file:///e:/Prueba/ansALEJO/server/src/routes/solCdsNuevos.ts)

Reglas típicas:

- Validar que el valor digitado exista en catálogo (frontend normaliza; backend valida contra tablas).

### 9.4) Componentes AT

**Objetivo:** listar componentes, filtrar por fechas/opciones y soportar acciones de asignación e instalación.

Frontend:
- Página: [ComponentesAtPage.tsx](file:///e:/Prueba/ansALEJO/web/src/pages/ComponentesAtPage.tsx)

Backend:
- Rutas: [componentesAt.ts](file:///e:/Prueba/ansALEJO/server/src/routes/componentesAt.ts)
- Cargue que alimenta la tabla: [cargues.ts](file:///e:/Prueba/ansALEJO/server/src/routes/cargues.ts)

Reglas operativas:

- Si no viene `ESTADO` en el cargue, se asigna `DISPONIBLE`.
- Acciones:
  - **Asignar**: asigna tecnólogo, marca `ASIGNADO`, setea `fechaAsignacion`.
  - **Instalación**: captura ORDEN/PF/DIRECCIÓN/MUNICIPIO/X/Y, marca `INSTALADO`, setea `fechaInstalacion`.

## 10) Patrones de UI reutilizados

### 10.1) Botón “Buscar” (no autoload por cada tecleo)

Implementación típica:

- Mantener `draft...` (inputs) y `applied...` (query activa).
- Un botón **Buscar** hace `setApplied(...)`.
- El fetch depende de `applied`.

Esto evita llamadas excesivas y replica el patrón de otros módulos.

### 10.2) Modales tipo overlay (Novedades / Instalación)

Se usa un overlay simple con `.modal-overlay` + `.modal-content`:
- Estilos: [index.css](file:///e:/Prueba/ansALEJO/web/src/index.css#L78-L121)
- Uso: páginas que abren modales (ej. Componentes AT y Levantamiento).

## 11) Debugging y diagnóstico (cómo se valida)

Buenas prácticas aplicadas en incidentes reales:

- Comparar endpoint de listado vs export vs métricas para alinear reglas (especialmente rangos de fecha).
- Verificar calendario: existencia del día y numeración Inicio/Fin.
- Confirmar campos “efectivos” usados por cálculo (ej. `gestionAt` vs `now`).

Ejemplo de endpoint de diagnóstico en API:
- [server/src/index.ts](file:///e:/Prueba/ansALEJO/server/src/index.ts#L201-L245) (`/debug/now`) para revisar “hoy” y calendar match.

## 12) Ejecución local (paso a paso)

Ver guía completa: [docs/local-dev.md](file:///e:/Prueba/ansALEJO/docs/local-dev.md).

Resumen:

1) Instalar:

```bash
npm install
```

2) Backend: configurar `server/.env` (ver [server/.env.example](file:///e:/Prueba/ansALEJO/server/.env.example)).

3) Prisma:

```bash
cd server
npx prisma db push
npx prisma generate
npm run prisma:seed
```

4) Correr todo:

```bash
cd ..
npm run dev
```

## 13) Despliegue (alto nivel)

Ver guía completa: [docs/deployment.md](file:///e:/Prueba/ansALEJO/docs/deployment.md).

Puntos críticos:

- `VITE_API_URL` (web) debe apuntar a la URL real de la API.
- `WEB_ORIGIN` (api) debe permitir los orígenes del frontend.
- Validar endpoints:
  - `/health`
  - `/version`

## 14) Checklist de cambios típicos (cómo se implementa un requerimiento)

Para cambios funcionales (ej. nuevo botón, nueva columna, nuevo filtro):

1. Identificar fuente de datos (tabla Prisma) y endpoint actual.
2. Confirmar que el backend retorna el campo (o agregarlo).
3. Añadirlo en el tipado frontend (`api.ts`) y en la UI.
4. Replicar patrón existente (filtros con Buscar, badges, modales).
5. Validar typecheck/build.
6. Commit + push para despliegue.

