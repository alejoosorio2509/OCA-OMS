import jwt from "jsonwebtoken";
import { env } from "./env.js";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "./prisma.js";

export type AuthTokenPayload = {
  sub: string;
  role: "ADMIN" | "USER";
  email: string;
};

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "8h" });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthTokenPayload;
    access?: {
      role: "ADMIN" | "USER";
      canOrders: boolean;
      canLevantamiento: boolean;
      canSolCdsNuevos: boolean;
      canCargues: boolean;
      canExportes: boolean;
      canUsers: boolean;
    };
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: "NO_AUTH" });
    return;
  }

  try {
    req.auth = verifyToken(match[1]);
    next();
  } catch {
    res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.role !== "ADMIN") {
    res.status(403).json({ error: "FORBIDDEN" });
    return;
  }
  next();
}

export type PermissionKey = "ORDERS" | "LEVANTAMIENTO" | "SOL_CDS_NUEVOS" | "CARGUES" | "EXPORTES" | "USERS";

async function loadAccess(req: Request) {
  if (req.access) return req.access;
  if (!req.auth) return undefined;
  const user = await prisma.user.findUnique({
    where: { id: req.auth.sub },
    select: {
      role: true,
      canOrders: true,
      canLevantamiento: true,
      canSolCdsNuevos: true,
      canCargues: true,
      canExportes: true,
      canUsers: true
    }
  });
  if (!user) return undefined;
  req.access = user;
  return user;
}

export function requirePermission(permission: PermissionKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: "NO_AUTH" });
      return;
    }
    if (req.auth.role === "ADMIN") {
      next();
      return;
    }
    const access = await loadAccess(req);
    if (!access) {
      res.status(401).json({ error: "NOT_FOUND" });
      return;
    }

    const ok =
      (permission === "ORDERS" && access.canOrders) ||
      (permission === "LEVANTAMIENTO" && access.canLevantamiento) ||
      (permission === "SOL_CDS_NUEVOS" && access.canSolCdsNuevos) ||
      (permission === "CARGUES" && access.canCargues) ||
      (permission === "EXPORTES" && access.canExportes) ||
      (permission === "USERS" && access.canUsers);

    if (!ok) {
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }
    next();
  };
}
