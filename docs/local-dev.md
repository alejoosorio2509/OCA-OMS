# Desarrollo local

## Requisitos

- Node.js + npm
- Acceso a una base de datos PostgreSQL (recomendado: Supabase)

## Variables de entorno

Backend: crea `server/.env` desde [server/.env.example](file:///e:/Prueba/ansALEJO/server/.env.example).

Valores:

- `DATABASE_URL`: URL de Postgres (Supabase).
- `JWT_SECRET`: secreto para firmar JWT (no lo expongas en frontend).
- `WEB_ORIGIN`: orígenes permitidos por CORS (separados por coma).
- `PORT`: por defecto 3001.

Frontend:

- `VITE_API_URL`: URL base de la API. Si no está, se asume `http://{host}:3001`. Ver [apiUrl.ts](file:///e:/Prueba/ansALEJO/web/src/apiUrl.ts).

## Instalar dependencias

Desde la raíz:

```bash
npm install
```

## Inicializar Prisma (DB)

Desde `server/`:

```bash
npx prisma generate
```

Crear tablas (elige uno):

- Sin migraciones (rápido, recomendado cuando ya tienes el schema y quieres sincronizar):

```bash
npx prisma db push
```

- Con migraciones (si estás usando migraciones en el proyecto):

```bash
npx prisma migrate deploy
```

Seed (usuarios demo):

```bash
npm run prisma:seed
```

## Ejecutar en desarrollo

Desde la raíz:

```bash
npm run dev
```

URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:3001/health`

## Troubleshooting común

- `Failed to fetch` en web: revisa `VITE_API_URL` y `WEB_ORIGIN` (CORS).
- Prisma no conecta: revisa `DATABASE_URL` y que tenga `sslmode=require` para Supabase.
- Cargues grandes: se procesan como jobs; revisa `GET /cargues/jobs/:id` y los logs.
