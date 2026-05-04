import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../auth.js";

export const usersRouter = Router();

const emailSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.string().email()
);

usersRouter.get("/", requireAuth, requirePermission("USERS"), async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      canOrders: true,
      canLevantamiento: true,
      canSolCdsNuevos: true,
      canAsignacionCompAt: true,
      canCargues: true,
      canExportes: true,
      canUsers: true,
      isTecnologo: true,
      createdAt: true
    }
  });
  res.json(users);
});

usersRouter.post("/", requireAuth, requirePermission("USERS"), async (req, res) => {
  const bodySchema = z.object({
    email: emailSchema,
    name: z.string().min(1),
    password: z.string().min(6),
    role: z.enum(["ADMIN", "USER"]).optional(),
    canOrders: z.boolean().optional(),
    canLevantamiento: z.boolean().optional(),
    canSolCdsNuevos: z.boolean().optional(),
    canAsignacionCompAt: z.boolean().optional(),
    canCargues: z.boolean().optional(),
    canExportes: z.boolean().optional(),
    canUsers: z.boolean().optional(),
    isTecnologo: z.boolean().optional()
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY", details: parsed.error.issues });
    return;
  }

  const {
    email,
    name,
    password,
    role,
    canOrders,
    canLevantamiento,
    canSolCdsNuevos,
    canAsignacionCompAt,
    canCargues,
    canExportes,
    canUsers,
    isTecnologo
  } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: "EMAIL_IN_USE" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      role: role ?? "USER",
      ...(canOrders !== undefined ? { canOrders } : {}),
      ...(canLevantamiento !== undefined ? { canLevantamiento } : {}),
      ...(canSolCdsNuevos !== undefined ? { canSolCdsNuevos } : {}),
      ...(canAsignacionCompAt !== undefined ? { canAsignacionCompAt } : {}),
      ...(canCargues !== undefined ? { canCargues } : {}),
      ...(canExportes !== undefined ? { canExportes } : {}),
      ...(canUsers !== undefined ? { canUsers } : {}),
      ...(isTecnologo !== undefined ? { isTecnologo } : {})
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      canOrders: true,
      canLevantamiento: true,
      canSolCdsNuevos: true,
      canAsignacionCompAt: true,
      canCargues: true,
      canExportes: true,
      canUsers: true,
      isTecnologo: true,
      createdAt: true
    }
  });

  res.status(201).json(user);
});

usersRouter.patch("/:id", requireAuth, requirePermission("USERS"), async (req, res) => {
  const params = z.object({ id: z.string().min(1) }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "INVALID_PARAMS" });
    return;
  }

  const bodySchema = z.object({
    email: emailSchema.optional(),
    name: z.string().min(1).optional(),
    role: z.enum(["ADMIN", "USER"]).optional(),
    canOrders: z.boolean().optional(),
    canLevantamiento: z.boolean().optional(),
    canSolCdsNuevos: z.boolean().optional(),
    canAsignacionCompAt: z.boolean().optional(),
    canCargues: z.boolean().optional(),
    canExportes: z.boolean().optional(),
    canUsers: z.boolean().optional(),
    isTecnologo: z.boolean().optional()
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY", details: parsed.error.issues });
    return;
  }

  const id = params.data.id;
  const current = await prisma.user.findUnique({ where: { id } });
  if (!current) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }

  if (parsed.data.email && parsed.data.email !== current.email) {
    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) {
      res.status(409).json({ error: "EMAIL_IN_USE" });
      return;
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: parsed.data,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      canOrders: true,
      canLevantamiento: true,
      canSolCdsNuevos: true,
      canAsignacionCompAt: true,
      canCargues: true,
      canExportes: true,
      canUsers: true,
      isTecnologo: true,
      createdAt: true
    }
  });
  res.json(updated);
});

usersRouter.post("/:id/reset-password", requireAuth, requirePermission("USERS"), async (req, res) => {
  const params = z.object({ id: z.string().min(1) }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "INVALID_PARAMS" });
    return;
  }

  const bodySchema = z.object({
    password: z.string().min(6).optional()
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY" });
    return;
  }

  const userId = params.data.id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }

  const nextPassword =
    parsed.data.password ??
    randomBytes(9)
      .toString("base64")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 12);

  const passwordHash = await bcrypt.hash(nextPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  res.json({ id: userId, password: nextPassword });
});
