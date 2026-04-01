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
    canCargues: user.canCargues,
    canExportes: user.canExportes,
    canUsers: user.canUsers
  });
});
