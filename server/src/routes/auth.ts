import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma.js";
import { requireAuth, signToken } from "../auth.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const bodySchema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY" });
    return;
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      passwordHash: true,
      canOrders: true,
      canLevantamiento: true,
      canCargues: true,
      canExportes: true,
      canUsers: true
    }
  });
  if (!user) {
    res.status(401).json({ error: "INVALID_CREDENTIALS" });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "INVALID_CREDENTIALS" });
    return;
  }

  const token = signToken({ sub: user.id, role: user.role, email: user.email });
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      canOrders: user.canOrders,
      canLevantamiento: user.canLevantamiento,
      canCargues: user.canCargues,
      canExportes: user.canExportes,
      canUsers: user.canUsers
    }
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.sub },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      canOrders: true,
      canLevantamiento: true,
      canCargues: true,
      canExportes: true,
      canUsers: true
    }
  });
  if (!user) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    canOrders: user.canOrders,
    canLevantamiento: user.canLevantamiento,
    canCargues: user.canCargues,
    canExportes: user.canExportes,
    canUsers: user.canUsers
  });
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const bodySchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6)
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY", details: parsed.error.issues });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.auth!.sub }, select: { id: true, passwordHash: true } });
  if (!user) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }

  const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "INVALID_CREDENTIALS" });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true });
});

authRouter.post("/reset-password", async (req, res) => {
  const bodySchema = z.object({
    email: z.string().email(),
    tempPassword: z.string().min(1),
    newPassword: z.string().min(6)
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY", details: parsed.error.issues });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, passwordHash: true } });
  if (!user) {
    res.status(401).json({ error: "INVALID_CREDENTIALS" });
    return;
  }

  const ok = await bcrypt.compare(parsed.data.tempPassword, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "INVALID_CREDENTIALS" });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true });
});
