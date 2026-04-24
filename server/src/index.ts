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

const app = express();

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

app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`API listening on port ${env.PORT} (0.0.0.0)`);
});
