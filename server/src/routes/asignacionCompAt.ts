import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../auth.js";

export const asignacionCompAtRouter = Router();

asignacionCompAtRouter.get("/", requireAuth, requirePermission("ASIGNACION_COMP_AT"), async (req, res) => {
  const querySchema = z.object({
    estado: z.string().optional(),
    tipo: z.string().optional(),
    tecnologo: z.string().optional()
  });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_QUERY" });
    return;
  }

  const { estado, tipo, tecnologo } = parsed.data;
  const where: Record<string, unknown> = {};
  if (estado) where.estado = { equals: estado, mode: "insensitive" };
  if (tipo) where.tipo = { equals: tipo, mode: "insensitive" };
  if (tecnologo) where.tecnologo = { equals: tecnologo, mode: "insensitive" };

  const rows = await prisma.asignacionCompAt.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 500
  });

  const out = rows.map((r) => {
    const estadoTxt = (r.estado ?? "").trim();
    const asignadoA =
      estadoTxt.toUpperCase() === "DISPONIBLE" ? "DISPONIBLE" : (r.tecnologo ?? "").trim() || "—";
    return { ...r, asignadoA };
  });

  res.json(out);
});

asignacionCompAtRouter.get("/tecnologos", requireAuth, requirePermission("ASIGNACION_COMP_AT"), async (_req, res) => {
  const rows = await prisma.user.findMany({
    where: { isTecnologo: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true }
  });
  res.json(rows);
});

asignacionCompAtRouter.post("/:rotulo/asignar", requireAuth, requirePermission("ASIGNACION_COMP_AT"), async (req, res) => {
  const paramsSchema = z.object({ rotulo: z.string().min(1) });
  const bodySchema = z.object({ tecnologoId: z.string().min(1) });
  const p = paramsSchema.safeParse(req.params);
  const b = bodySchema.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: "INVALID_BODY" });
    return;
  }

  const tech = await prisma.user.findUnique({
    where: { id: b.data.tecnologoId },
    select: { id: true, name: true, email: true, isTecnologo: true }
  });
  if (!tech || !tech.isTecnologo) {
    res.status(400).json({ error: "INVALID_TECNOLOGO" });
    return;
  }

  const updated = await prisma.asignacionCompAt.update({
    where: { rotulo: p.data.rotulo },
    data: {
      estado: "ASIGNADO",
      tecnologo: tech.name || tech.email
    }
  });

  res.json(updated);
});

