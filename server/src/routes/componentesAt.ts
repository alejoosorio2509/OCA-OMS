import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../auth.js";

export const componentesAtRouter = Router();

componentesAtRouter.get("/", requireAuth, requirePermission("CARGUES"), async (req, res) => {
  const querySchema = z.object({
    rotulo: z.string().optional(),
    tipo: z.string().optional(),
    tecnologo: z.string().optional(),
    estado: z.string().optional()
  });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_QUERY" });
    return;
  }

  const { rotulo, tipo, tecnologo, estado } = parsed.data;
  const where: Record<string, unknown> = {};
  if (rotulo) where.rotulo = { contains: rotulo.trim(), mode: "insensitive" };
  if (tipo) where.tipo = { equals: tipo.trim(), mode: "insensitive" };
  if (tecnologo) where.tecnologo = { equals: tecnologo.trim(), mode: "insensitive" };
  if (estado) where.estado = { equals: estado.trim(), mode: "insensitive" };

  const rows = await prisma.asignacionCompAt.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 500
  });

  res.json(rows);
});
