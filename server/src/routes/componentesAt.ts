import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../auth.js";

export const componentesAtRouter = Router();

function parseDateOnlyStart(value: string): Date | null {
  const s = value.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseDateOnlyEnd(value: string): Date | null {
  const s = value.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mo - 1, d, 23, 59, 59, 999);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

componentesAtRouter.get("/options", requireAuth, requirePermission("CARGUES"), async (_req, res) => {
  const [tiposRaw, tecnologosRaw, estadosRaw] = await Promise.all([
    prisma.asignacionCompAt.findMany({ select: { tipo: true }, distinct: ["tipo"], orderBy: [{ tipo: "asc" }], take: 5000 }),
    prisma.asignacionCompAt.findMany({
      select: { tecnologo: true },
      distinct: ["tecnologo"],
      orderBy: [{ tecnologo: "asc" }],
      take: 5000
    }),
    prisma.asignacionCompAt.findMany({ select: { estado: true }, distinct: ["estado"], orderBy: [{ estado: "asc" }], take: 5000 })
  ]);

  const clean = (v: string | null) => (v ?? "").trim();
  const tipos = tiposRaw.map((r) => clean(r.tipo)).filter(Boolean);
  const tecnologos = tecnologosRaw.map((r) => clean(r.tecnologo)).filter(Boolean);
  const estados = estadosRaw.map((r) => clean(r.estado)).filter(Boolean);

  res.json({ tipos, tecnologos, estados });
});

componentesAtRouter.get("/", requireAuth, requirePermission("CARGUES"), async (req, res) => {
  const querySchema = z.object({
    rotulo: z.string().optional(),
    tipo: z.string().optional(),
    tecnologo: z.string().optional(),
    estado: z.string().optional(),
    asignacionStart: z.string().optional(),
    asignacionEnd: z.string().optional(),
    instalacionStart: z.string().optional(),
    instalacionEnd: z.string().optional()
  });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_QUERY" });
    return;
  }

  const { rotulo, tipo, tecnologo, estado, asignacionStart, asignacionEnd, instalacionStart, instalacionEnd } = parsed.data;
  const where: Record<string, unknown> = {};
  if (rotulo) where.rotulo = { contains: rotulo.trim(), mode: "insensitive" };
  if (tipo) where.tipo = { equals: tipo.trim(), mode: "insensitive" };
  if (tecnologo) where.tecnologo = { equals: tecnologo.trim(), mode: "insensitive" };
  if (estado) where.estado = { equals: estado.trim(), mode: "insensitive" };

  const asignStart = asignacionStart ? parseDateOnlyStart(asignacionStart) : null;
  const asignEnd = asignacionEnd ? parseDateOnlyEnd(asignacionEnd) : null;
  if (asignacionStart && !asignStart) {
    res.status(400).json({ error: "INVALID_ASIGNACION_START" });
    return;
  }
  if (asignacionEnd && !asignEnd) {
    res.status(400).json({ error: "INVALID_ASIGNACION_END" });
    return;
  }
  if (asignStart || asignEnd) where.fechaAsignacion = { ...(asignStart ? { gte: asignStart } : {}), ...(asignEnd ? { lte: asignEnd } : {}) };

  const instStart = instalacionStart ? parseDateOnlyStart(instalacionStart) : null;
  const instEnd = instalacionEnd ? parseDateOnlyEnd(instalacionEnd) : null;
  if (instalacionStart && !instStart) {
    res.status(400).json({ error: "INVALID_INSTALACION_START" });
    return;
  }
  if (instalacionEnd && !instEnd) {
    res.status(400).json({ error: "INVALID_INSTALACION_END" });
    return;
  }
  if (instStart || instEnd) where.fechaInstalacion = { ...(instStart ? { gte: instStart } : {}), ...(instEnd ? { lte: instEnd } : {}) };

  const rows = await prisma.asignacionCompAt.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 500
  });

  res.json(rows);
});
