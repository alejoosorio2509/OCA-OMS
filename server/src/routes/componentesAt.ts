import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../auth.js";

export const componentesAtRouter = Router();

componentesAtRouter.get("/", requireAuth, requirePermission("CARGUES"), async (req, res) => {
  const querySchema = z.object({
    codigo: z.string().optional(),
    tipo: z.string().optional(),
    tecnologo: z.string().optional()
  });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_QUERY" });
    return;
  }

  const { codigo, tipo, tecnologo } = parsed.data;
  const where: Record<string, unknown> = {};
  if (codigo) where.codigo = { contains: codigo.trim(), mode: "insensitive" };
  if (tipo) where.tipo = { equals: tipo.trim(), mode: "insensitive" };
  if (tecnologo) where.tecnologo = { equals: tecnologo.trim(), mode: "insensitive" };

  const rows = await prisma.componenteAt.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 500
  });

  res.json(rows);
});
