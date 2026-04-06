# Cargues (CSV/XLSX)

El módulo de cargues soporta procesamiento síncrono y asíncrono. En producción se recomienda usar **asíncrono** (jobs persistentes en DB).

Código: [routes/cargues.ts](file:///e:/Prueba/ansALEJO/server/src/routes/cargues.ts)

## Tipos soportados

- `ACTUALIZACION`
- `DEVOLUCIONES`
- `CALENDARIO`
- `ACTIVIDADES_BAREMO`
- `RECORRIDO_INCREMENTOS`

## Endpoint

`POST /cargues/upload` (multipart/form-data)

Campos:

- `file`: archivo CSV o XLSX
- `type`: uno de los tipos soportados
- `async`: `1` para job persistente
- `cleanupMissing`: `1` donde aplique (limpieza de registros no presentes)

Respuesta:

- `202 { jobId }` cuando `async=1`
- `200 { message, count, ... }` si procesa directo

Polling:

- `GET /cargues/jobs/:id` → estado/progreso/resultado

Modelo DB para jobs: `CargueJob` en [schema.prisma](file:///e:/Prueba/ansALEJO/server/prisma/schema.prisma#L108-L136)

## Límites de tamaño

- Por defecto: 50 MB
- `ACTIVIDADES_BAREMO`: 100 MB

## CSV: delimitador y encoding

El parser intenta UTF-8 y si falla reintenta con Latin1.

Delimitador:

- `;` para `ACTUALIZACION`, `ACTIVIDADES_BAREMO`, `RECORRIDO_INCREMENTOS`
- `,` para los demás

## Calendario y zona horaria

El cargue de `CALENDARIO` normaliza fechas y evita desfases de UTC. Si el archivo trae fechas ISO (`YYYY-MM-DD`) se interpretan como fecha Colombia para evitar corrimientos.

El sistema corrige inconsistencias donde `Fin < Inicio` invirtiendo los valores al guardar.

## Buenas prácticas operativas

- Si cambiaste lógica de fechas/calendario, recarga primero `CALENDARIO`.
- Para “limpiar” recorridos antes de un cargue: vacía `RecorridoIncremento` y el historial `Recorrido Incrementos (ENEL)` en Supabase SQL Editor (ver procedimiento operativo acordado).
- Si cargas archivos grandes, usa `async=1` y espera a que el job termine.
