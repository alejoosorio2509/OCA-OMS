# Gestión de Órdenes de Trabajo (OT)

Aplicación web con login para gestionar órdenes de trabajo con ciclo de vida completo, vencimientos y criticidad.

## Requisitos

- Node.js (incluye npm)

## Primer arranque

En la raíz del proyecto:

```bash
npm install
```

Base de datos (SQLite) + datos iniciales:

```bash
cd server
npx prisma migrate dev --name init
npm run prisma:seed
```

Levantar frontend + backend:

```bash
cd ..
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:3001

## Credenciales demo

- Admin: `admin@local.test` / `admin123`
- Usuario: `usuario@local.test` / `usuario123`

## Funcionalidades

- Login con JWT
- CRUD de órdenes de trabajo
- Estados (ciclo de vida): CREATED → ASSIGNED → IN_PROGRESS → (ON_HOLD) → COMPLETED / CANCELLED
- Vencimiento (`dueAt`) y cálculo de:
  - `overdue`: vencida y no completada/cancelada
  - `compliant`: completada antes del vencimiento (si existe `dueAt`)
- Criticidad: LOW / MEDIUM / HIGH / CRITICAL
- Historial de cambios de estado (quién, cuándo, nota opcional)

