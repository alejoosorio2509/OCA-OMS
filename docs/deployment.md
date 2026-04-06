# Deployment (Render + Vercel + Supabase)

## Supabase (DB)

1) Crea un proyecto.
2) Copia la conexión Postgres y configura `DATABASE_URL` en Render.
3) Crea/actualiza tablas con Prisma:

- Local (recomendado antes del primer deploy):
  - Desde `server/`: `npx prisma db push` o `npx prisma migrate deploy`

Schema: [schema.prisma](file:///e:/Prueba/ansALEJO/server/prisma/schema.prisma)

## Render (Backend)

Servicio recomendado: Web Service (Node).

### Configuración

- Root Directory: `server`
- Build Command (sugerido):

```bash
npm install && npx prisma generate && npm run build
```

- Start Command:

```bash
npm start
```

### Variables de entorno

- `DATABASE_URL`
- `JWT_SECRET`
- `WEB_ORIGIN` (ej: `https://tu-frontend.vercel.app` o `https://tu-frontend-*`)
- `NODE_OPTIONS` (opcional, si necesitas más memoria): `--max-old-space-size=2048`

Healthcheck:

- `GET https://<tu-servicio>.onrender.com/health`

## Vercel (Frontend)

Proyecto Vite/React.

### Configuración

- Root Directory: `web`
- Build Command: `npm run build`
- Output Directory: `dist`
- Environment Variable:
  - `VITE_API_URL=https://<tu-servicio>.onrender.com`

SPA routing:

- [vercel.json](file:///e:/Prueba/ansALEJO/web/vercel.json) incluye rewrite a `index.html` para rutas tipo `/orders/:id`.

## CORS (WEB_ORIGIN)

La API valida el origin contra `WEB_ORIGIN` (lista separada por comas y wildcard al final).

Ejemplos:

- `WEB_ORIGIN=https://oca-oms-web.vercel.app`
- `WEB_ORIGIN=https://oca-oms-web.vercel.app,https://oca-oms-*.vercel.app`

CORS está configurado en [index.ts](file:///e:/Prueba/ansALEJO/server/src/index.ts#L13-L31).
