import express from "express";
import cors from "cors";
import { env } from "./env.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { workOrdersRouter } from "./routes/workOrders.js";
import { carguesRouter } from "./routes/cargues.js";
import { exportsRouter } from "./routes/exports.js";
import { levantamientosRouter } from "./routes/levantamientos.js";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "./prisma.js";

const app = express();

async function ensureLevantamientoEntregaColumns() {
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "Levantamiento" ADD COLUMN IF NOT EXISTS "entregaLevantamiento" TEXT');
    await prisma.$executeRawUnsafe('ALTER TABLE "Levantamiento" ADD COLUMN IF NOT EXISTS "tipoOtLevantamiento" TEXT');
    await prisma.$executeRawUnsafe('ALTER TABLE "Levantamiento" ADD COLUMN IF NOT EXISTS "entregaKeyLevantamiento" TEXT');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`WARN: No se pudo asegurar columnas de entrega levantamiento: ${msg}`);
  }
}

async function ensureUserPermissionColumns() {
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canLevantamiento" BOOLEAN NOT NULL DEFAULT true');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`WARN: No se pudo asegurar columnas de permisos de usuario: ${msg}`);
  }
}

async function ensureCarguesCatalogTables() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ModeloCategoriaMb" (
        "id" TEXT PRIMARY KEY,
        "categoria" TEXT,
        "descripcionCategoria" TEXT,
        "sigla" TEXT,
        "denominacionFabricante" TEXT,
        "tipoComp" TEXT,
        "descripcionTipo" TEXT,
        "tabUnif" TEXT,
        "tipoUnifCodMaterial" TEXT,
        "codMod" TEXT,
        "modelo" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ModeloCategoriaMb_codMod_idx" ON "ModeloCategoriaMb"("codMod")`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "ModeloCategoriaMb_tipoUnifCodMaterial_idx" ON "ModeloCategoriaMb"("tipoUnifCodMaterial")`
    );

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CircuitoSubestacion" (
        "codCircuito" TEXT PRIMARY KEY,
        "nomCircuito" TEXT,
        "nomSubestacion" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`WARN: No se pudo asegurar tablas de catálogos de cargues: ${msg}`);
  }
}

function getBuildInfo() {
  const commit =
    process.env.RENDER_GIT_COMMIT ??
    process.env.GITHUB_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.COMMIT_SHA ??
    null;
  const service =
    process.env.RENDER_SERVICE_NAME ?? process.env.RENDER_SERVICE_ID ?? process.env.VERCEL ?? process.env.NODE_ENV ?? null;
  return { commit, service };
}

app.use(
  cors({
    origin: (origin, cb) => {
      const allowed = env.WEB_ORIGIN.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!origin) {
        cb(null, true);
        return;
      }
      const ok = allowed.some((entry) => {
        if (entry.endsWith("*")) return origin.startsWith(entry.slice(0, -1));
        return origin === entry;
      });
      cb(null, ok);
    },
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.status(200).json({ ok: true, ...getBuildInfo() });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, ...getBuildInfo() });
});

app.get("/version", (_req, res) => {
  res.json(getBuildInfo());
});

// Servir archivos estáticos de soportes
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
const supabase =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : null;

app.get("/uploads/*path", async (req, res) => {
  try {
    if (!supabase) {
      res.status(404).end();
      return;
    }
    const key = req.path.startsWith("/uploads/") ? decodeURIComponent(req.path.slice("/uploads/".length)) : "";
    if (!key) {
      res.status(404).end();
      return;
    }

    const bucket =
      key.startsWith("novedades/")
        ? env.SUPABASE_STORAGE_BUCKET_NOVEDADES
        : key.startsWith("postproceso/")
          ? env.SUPABASE_STORAGE_BUCKET_POSTPROCESO
          : env.SUPABASE_STORAGE_BUCKET;

    const { data: signed, error: signErr } = await supabase.storage.from(bucket).createSignedUrl(key, 60 * 5);
    if (!signErr && signed?.signedUrl) {
      res.setHeader("cache-control", "no-store");
      res.redirect(302, signed.signedUrl);
      return;
    }

    const { data, error } = await supabase.storage.from(bucket).download(key);
    if (error || !data) {
      res.status(404).end();
      return;
    }

    const buf = Buffer.from(await data.arrayBuffer());
    if (data.type) res.setHeader("content-type", data.type);
    res.setHeader("cache-control", "public, max-age=3600");
    res.status(200).send(buf);
  } catch {
    res.status(500).end();
  }
});

app.use("/auth", authRouter);
app.use("/users", usersRouter);
app.use("/work-orders", workOrdersRouter);
app.use("/cargues", carguesRouter);
app.use("/levantamientos", levantamientosRouter);
app.use("/exports", exportsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "NOT_FOUND" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: "INTERNAL_ERROR" });
});

Promise.all([ensureLevantamientoEntregaColumns(), ensureUserPermissionColumns(), ensureCarguesCatalogTables()]).finally(() => {
  app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`API listening on port ${env.PORT} (0.0.0.0)`);
  });
});
