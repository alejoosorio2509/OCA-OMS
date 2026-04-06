# OCA-OMS (Gestión de Órdenes de Trabajo)

Sistema web con autenticación y permisos para gestionar órdenes de trabajo (OT), cargues masivos y exportes. Arquitectura: **Vercel (Web)** → **Render (API)** → **Supabase Postgres (DB)**.

## Estructura del repo

- Backend: [server](file:///e:/Prueba/ansALEJO/server)
- Frontend: [web](file:///e:/Prueba/ansALEJO/web)
- Prisma (modelos/migraciones/seed): [server/prisma](file:///e:/Prueba/ansALEJO/server/prisma)

## Requisitos

- Node.js + npm
- Base de datos PostgreSQL (recomendado: Supabase)

## Variables de entorno

Backend: crea `server/.env` basado en [server/.env.example](file:///e:/Prueba/ansALEJO/server/.env.example):

- `DATABASE_URL` (Postgres)
- `JWT_SECRET`
- `WEB_ORIGIN` (lista separada por comas; soporta wildcard al final, por ejemplo `https://miapp-*`)
- `PORT` (default 3001)

Frontend: en Vercel o local, define `VITE_API_URL` (ej: `https://tu-api.onrender.com`). Si no existe, usa `http://{host}:3001`. Ver [apiUrl.ts](file:///e:/Prueba/ansALEJO/web/src/apiUrl.ts).

## Arranque local

1) Instalar dependencias en la raíz:

```bash
npm install
```

2) Inicializar DB (elige uno):

- Supabase/DB ya existente (sin migraciones): desde `server/`
```bash
npx prisma db push
npx prisma generate
npm run prisma:seed
```

- Con migraciones (si tu DB las soporta): desde `server/`
```bash
npx prisma migrate deploy
npx prisma generate
npm run prisma:seed
```

3) Levantar backend + frontend:

```bash
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:3001/health

## Credenciales demo (seed)

- Admin: `admin@local.test` / `admin123`
- Usuario: `usuario@local.test` / `usuario123`

## Documentación del código

- [docs/overview.md](file:///e:/Prueba/ansALEJO/docs/overview.md)
- [docs/local-dev.md](file:///e:/Prueba/ansALEJO/docs/local-dev.md)
- [docs/deployment.md](file:///e:/Prueba/ansALEJO/docs/deployment.md)
- [docs/api.md](file:///e:/Prueba/ansALEJO/docs/api.md)
- [docs/cargues.md](file:///e:/Prueba/ansALEJO/docs/cargues.md)
- [docs/data-model.md](file:///e:/Prueba/ansALEJO/docs/data-model.md)

