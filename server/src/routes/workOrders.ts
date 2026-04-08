import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAdmin, requireAuth, requirePermission } from "../auth.js";
import type { Prisma, WorkOrderStatus } from "@prisma/client";
import { canTransition } from "../workOrderStateMachine.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const storage = multer.diskStorage({
  destination: (req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    const uploadDir = path.join(process.cwd(), "uploads", "novedades");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

const statusSchema = z.enum([
  "DRAFT",
  "CREATED",
  "ASSIGNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
  "EXCLUDED",
  "FACTURADA",
  "GESTIONADA",
  "CERRADA",
  "ASIGNADA",
  "EN_EJECUCION",
  "DEVUELTA"
]);

const criticalitySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
type Status = z.infer<typeof statusSchema>;

type WorkOrderWithUsers = Prisma.WorkOrderGetPayload<{
  include: {
    createdBy: { select: { id: true; name: true; email: true } };
    assignee: { select: { id: true; name: true; email: true } };
    novedades: true;
  };
}>;

type WorkOrderListWithUsers = Prisma.WorkOrderGetPayload<{
  include: {
    createdBy: { select: { id: true; name: true; email: true } };
    assignee: { select: { id: true; name: true; email: true } };
  };
}>;

type CumplimientoValue = "Cumple" | "No cumple" | null;

type SortableListItem = {
  code: string;
  status: WorkOrderStatus;
  assignedAt: Date | null;
  gestionAt: Date | null;
  gestorNombre?: string | null;
  oportunidad?: string | null;
  ansOportunidad?: number | null;
  diasGestion?: number | null;
  diasCumplimiento?: number | null;
  diasDevoluciones?: number | null;
  baremoAnsCalc?: number | null;
  diasEnel?: number | null;
  totalDiasDescuento?: number | null;
  diasPasados?: number | null;
  cumplimiento?: CumplimientoValue;
  fechaTentativaGestion?: string | null;
};

function computeOrderDerived<
  T extends {
    status: WorkOrderStatus;
    dueAt: Date | null;
    completedAt: Date | null;
    assignedAt: Date | null;
    gestionAt: Date | null;
    ansOportunidad: number | null;
    diasDescuento: number;
  }
>(
  workOrder: T,
  inicioMap?: Map<string, number>,
  finMap?: Map<string, number>,
  finNumberToDate?: Map<number, string>,
  maxFinNumber?: number
) {
  const now = new Date();

  const dueAtMs = workOrder.dueAt?.getTime();
  const overdue =
    dueAtMs !== undefined &&
    dueAtMs < now.getTime() &&
    workOrder.status !== "COMPLETED" &&
    workOrder.status !== "CANCELLED";

  const compliant =
    workOrder.completedAt && workOrder.dueAt
      ? workOrder.completedAt.getTime() <= workOrder.dueAt.getTime()
      : null;

  // DÍAS GESTIÓN (base)
  // Se calcula con el calendario cargado:
  // - assignedAt usa el número de día "Inicio"
  // - gestionAt (o hoy si no hay gestionAt) usa el número de día "Fin"
  // Fórmula: (Fin(gestionAt|hoy) - Inicio(assignedAt)) - diasDescuento
  let diasGestion: number | null = null;
  const nowNum = finMap?.get(normalizeDay(now)) ?? maxFinNumber;
  const assignedNum = workOrder.assignedAt ? inicioMap?.get(normalizeDay(workOrder.assignedAt)) : undefined;

  if (assignedNum !== undefined) {
    const gestionRef = workOrder.gestionAt ?? now;
    const gestionNum =
      finMap?.get(normalizeDay(gestionRef)) ??
      (workOrder.gestionAt ? undefined : nowNum);
    if (gestionNum !== undefined) {
      diasGestion = (gestionNum - assignedNum) - workOrder.diasDescuento;
    }
  }

  // FECHA TENTATIVA/GESTIÓN
  // - Si ya existe gestionAt, se muestra esa fecha/hora.
  // - Si no existe, se proyecta con el calendario:
  //   Inicio(assignedAt) + ansOportunidad + diasDescuento => se busca la fecha por el número "Fin".
  let fechaTentativaGestion: string | null = null;
  if (workOrder.gestionAt) {
    fechaTentativaGestion = workOrder.gestionAt.toISOString();
  } else if (inicioMap && finNumberToDate && workOrder.assignedAt && workOrder.ansOportunidad != null) {
    if (assignedNum !== undefined) {
      const offset = workOrder.ansOportunidad + (workOrder.diasDescuento || 0);
      fechaTentativaGestion = finNumberToDate.get(assignedNum + offset) ?? null;
    }
  }

  // DÍAS PASADOS y CUMPLIMIENTO
  // Se calcula contra el vencimiento (assignedNum + ansOportunidad + diasDescuento) y se compara con:
  // - Fin(gestionAt) si ya existe gestión
  // - Fin(hoy) si no existe gestión
  let diasPasados: number | null = null;
  let cumplimiento: CumplimientoValue = null;

  if (workOrder.status === "EXCLUDED") {
    cumplimiento = "Cumple";
  }

  if (inicioMap && finMap && workOrder.assignedAt && workOrder.ansOportunidad != null && assignedNum !== undefined) {
    const vencimientoNum = assignedNum + workOrder.ansOportunidad + (workOrder.diasDescuento || 0);

    let refNum: number | undefined;
    if (workOrder.gestionAt) {
      refNum = finMap.get(normalizeDay(workOrder.gestionAt));
    } else {
      refNum = nowNum ?? maxFinNumber;
    }

    if (refNum !== undefined) {
      diasPasados = vencimientoNum - refNum;
      if (cumplimiento === null) {
        cumplimiento = diasPasados >= 0 ? "Cumple" : "No cumple";
      }
    }
  }

  const totalDiasDescuento = workOrder.diasDescuento;

  return {
    overdue,
    compliant,
    diasGestion,
    diasPasados,
    totalDiasDescuento,
    cumplimiento,
    fechaTentativaGestion
  };
}

function toListDto(
  workOrder: WorkOrderListWithUsers,
  inicioMap?: Map<string, number>,
  finMap?: Map<string, number>,
  finNumberToDate?: Map<number, string>,
  maxFinNumber?: number
) {
  return {
    ...workOrder,
    ...computeOrderDerived(workOrder, inicioMap, finMap, finNumberToDate, maxFinNumber)
  };
}

function toDto(
  workOrder: WorkOrderWithUsers,
  inicioMap?: Map<string, number>,
  finMap?: Map<string, number>,
  finNumberToDate?: Map<number, string>,
  maxFinNumber?: number
) {
  return {
    ...workOrder,
    ...computeOrderDerived(workOrder, inicioMap, finMap, finNumberToDate, maxFinNumber),
    novedades: workOrder.novedades
  };
}

export const workOrdersRouter = Router();

const BOGOTA_TZ = "America/Bogota";
const bogotaDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: BOGOTA_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

function normalizeDay(date: Date) {
  return bogotaDateFmt.format(date);
}

function parseBogotaDateOnly(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    return new Date(Date.UTC(y, mo - 1, d, 5, 0, 0));
  }
  return new Date(value);
}

function calendarKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

type CalendarMaps = {
  inicioMap: Map<string, number>;
  finMap: Map<string, number>;
  finNumberToDate: Map<number, string>;
  maxFinNumber: number | undefined;
};

async function loadCalendarMaps(): Promise<CalendarMaps> {
  // El calendario se carga desde el módulo de Cargues.
  // - dayNumber = columna "Inicio"
  // - dayNumberFin = columna "Fin" (si no existe, se usa dayNumber como fallback)
  const calendar = await prisma.calendar.findMany({
    select: { date: true, dayNumber: true, dayNumberFin: true }
  });

  const inicioMap = new Map<string, number>();
  const finMap = new Map<string, number>();
  const finNumberToDate = new Map<number, string>();
  let maxFinNumber: number | undefined;

  for (const c of calendar) {
    const key = calendarKey(c.date);
    inicioMap.set(key, c.dayNumber);
    const finNum = c.dayNumberFin ?? c.dayNumber;
    finMap.set(key, finNum);
    finNumberToDate.set(finNum, key);
    if (maxFinNumber === undefined || finNum > maxFinNumber) maxFinNumber = finNum;
  }

  return { inicioMap, finMap, finNumberToDate, maxFinNumber };
}

function computeCumplimientoAdjusted(
  input: {
    status: WorkOrderStatus;
    assignedAt: Date | null;
    gestionAt: Date | null;
    ansOportunidad: number | null;
    diasDescuento: number;
  },
  inicioMap: Map<string, number>,
  finMap: Map<string, number>,
  maxFinNumber: number | undefined,
  extraDescuento: number
) {
  if (input.status === "EXCLUDED") return "Cumple" as const;
  if (!input.assignedAt || input.ansOportunidad == null) return null;

  const assignedNum = inicioMap.get(normalizeDay(input.assignedAt));
  if (assignedNum === undefined) return null;

  const nowFinNum = finMap.get(normalizeDay(new Date())) ?? maxFinNumber;
  const refNum = input.gestionAt
    ? finMap.get(normalizeDay(input.gestionAt))
    : nowFinNum;

  if (refNum === undefined) return null;

  const totalDiasDescuento = input.diasDescuento + extraDescuento;
  const vencimientoNum = assignedNum + input.ansOportunidad + totalDiasDescuento;
  const diasPasados = vencimientoNum - refNum;
  return diasPasados >= 0 ? ("Cumple" as const) : ("No cumple" as const);
}

workOrdersRouter.get("/gestores", requireAuth, requirePermission("ORDERS"), async (req, res) => {
  const rows = await prisma.workOrder.findMany({
    where: { gestorNombre: { not: null } },
    select: { gestorNombre: true },
    distinct: ["gestorNombre"],
    orderBy: { gestorNombre: "asc" }
  });
  res.json(rows.map(r => r.gestorNombre).filter((v): v is string => !!v));
});

workOrdersRouter.get("/oportunidades", requireAuth, requirePermission("ORDERS"), async (_req, res) => {
  const rows = await prisma.workOrder.findMany({
    where: { oportunidad: { not: null } },
    select: { oportunidad: true },
    distinct: ["oportunidad"],
    orderBy: { oportunidad: "asc" }
  });
  res.json(rows.map(r => r.oportunidad).filter((v): v is string => !!v));
});

workOrdersRouter.get("/metrics", requireAuth, requirePermission("ORDERS"), async (req, res) => {
  const querySchema = z.object({
    status: z.union([statusSchema, z.array(statusSchema)]).optional(),
    assigneeId: z.string().min(1).optional(),
    search: z.string().min(1).optional(),
    gestor: z.string().min(1).optional(),
    oportunidad: z.string().min(1).optional(),
    dateField: z.enum(["assignedAt", "gestionAt"]).optional(),
    dateStart: z.string().optional(),
    dateEnd: z.string().optional(),
    colorFilter: z.enum(["red", "green"]).optional()
  });

  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_QUERY" });
    return;
  }

  const { status, assigneeId, search, gestor, oportunidad, dateField, dateStart, dateEnd, colorFilter } = parsed.data;

  await prisma.workOrder.updateMany({
    where: { estadoSecundario: "DEVUELTA", status: { not: "DEVUELTA" } },
    data: { status: "DEVUELTA" }
  });

  const { inicioMap, finMap, maxFinNumber } = await loadCalendarMaps();

  const where: Prisma.WorkOrderWhereInput = {
    ...(assigneeId ? { assigneeId } : {}),
    ...(gestor ? { gestorNombre: { contains: gestor } } : {}),
    ...(oportunidad ? { oportunidad: { contains: oportunidad } } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search } },
            { title: { contains: search } },
            { gestorNombre: { contains: search } },
            { oportunidad: { contains: search } }
          ]
        }
      : {}),
  };

  if (status) {
    const statusArray: Status[] = Array.isArray(status) ? status : [status];
    const statusConditions: Prisma.WorkOrderWhereInput[] = [
      { status: { in: statusArray as unknown as WorkOrderStatus[] } }
    ];
    if (statusArray.includes("DEVUELTA")) statusConditions.push({ estadoSecundario: "DEVUELTA" });
    where.OR = statusConditions;
  }

  if (dateField && (dateStart || dateEnd)) {
    const range = {
      ...(dateStart ? { gte: new Date(dateStart) } : {}),
      ...(dateEnd ? { lte: new Date(dateEnd) } : {}),
    };
    if (dateField === "assignedAt") where.assignedAt = range;
    if (dateField === "gestionAt") where.gestionAt = range;
  }

  const base = await prisma.workOrder.findMany({
    where,
    select: {
      code: true,
      status: true,
      assignedAt: true,
      gestionAt: true,
      ansOportunidad: true,
      diasDescuento: true
    }
  });

  const codes = base.map((b) => b.code);
  const [baremos, enelGroups] = await Promise.all([
    prisma.actividadBaremo.findMany({
      where: { codigo: { in: codes } },
      select: { codigo: true, ansCalc: true }
    }),
    prisma.recorridoIncremento.groupBy({
      by: ["orderCode", "nombreIncremento"],
      where: { orderCode: { in: codes }, responsable: "ENEL", diasEnel: { not: null } },
      _sum: { diasEnel: true },
      _count: { diasEnel: true }
    })
  ]);
  const baremoMap = new Map(baremos.map((b) => [b.codigo, b]));
  const enelSumMap = new Map<string, number>();
  for (const g of enelGroups) {
    const sum = g._sum.diasEnel ?? 0;
    const count = g._count.diasEnel ?? 0;
    const finalSum = sum === 0 && count > 0 ? 1 : sum;
    enelSumMap.set(g.orderCode, (enelSumMap.get(g.orderCode) ?? 0) + finalSum);
  }

  const byStatus: Record<string, number> = {};
  let total = 0;
  let cumplan = 0;
  let noCumplan = 0;

  for (const o of base) {
    const baremoRow = baremoMap.get(o.code);
    const baremoInt = typeof baremoRow?.ansCalc === "number" ? Math.round(baremoRow.ansCalc) : 0;
    const diasEnel = enelSumMap.get(o.code) ?? 0;
    const extraDescuento = baremoInt + diasEnel;

    const cumplimiento = computeCumplimientoAdjusted(
      {
        status: o.status,
        assignedAt: o.assignedAt,
        gestionAt: o.gestionAt,
        ansOportunidad: o.ansOportunidad,
        diasDescuento: o.diasDescuento
      },
      inicioMap,
      finMap,
      maxFinNumber,
      extraDescuento
    );

    if (colorFilter) {
      if (cumplimiento === null) continue;
      const isRed = cumplimiento === "No cumple";
      if (colorFilter === "red" && !isRed) continue;
      if (colorFilter === "green" && isRed) continue;
    }

    total++;
    byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    if (cumplimiento === "Cumple") cumplan++;
    if (cumplimiento === "No cumple") noCumplan++;
  }

  const denom = cumplan + noCumplan;
  const ansPct = denom > 0 ? Math.round((cumplan / denom) * 100) : 0;

  res.json({
    total,
    cumplan,
    noCumplan,
    ansPct,
    asignadas: byStatus["ASIGNADA"] || 0,
    enEjecucion: byStatus["EN_EJECUCION"] || 0,
    pausadas: byStatus["ON_HOLD"] || 0,
    gestionadas: byStatus["GESTIONADA"] || 0,
    facturadas: byStatus["FACTURADA"] || 0,
    cerradas: byStatus["CERRADA"] || 0,
    devueltas: byStatus["DEVUELTA"] || 0
  });
});

workOrdersRouter.post("/recalcular-devoluciones/:code", requireAuth, requireAdmin, async (req, res) => {
  const params = z.object({ code: z.string().min(1) }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "INVALID_PARAMS" });
    return;
  }

  const code = params.data.code;
  const order = await prisma.workOrder.findUnique({
    where: { code },
    select: { id: true, code: true, status: true, assignedAt: true, diasDescuento: true }
  });
  if (!order) {
    res.status(404).json({ error: "ORDER_NOT_FOUND" });
    return;
  }

  const { inicioMap, finMap } = await loadCalendarMaps();

  const histories = await prisma.workOrderHistory.findMany({
    where: {
      workOrderId: order.id,
      note: { contains: "Descuento por devolución" }
    },
    select: { id: true, fechaInicio: true, fechaFin: true }
  });

  const assignedDay = order.assignedAt ? normalizeDay(order.assignedAt) : null;
  const assignedTs = assignedDay ? new Date(assignedDay).getTime() : null;

  let oldSum = 0;
  let newSum = 0;
  const omitted: string[] = [];

  for (const h of histories) {
    if (!h.fechaInicio || !h.fechaFin) continue;
    const dev = new Date(h.fechaInicio);
    const resFin = new Date(h.fechaFin);
    if (Number.isNaN(dev.getTime()) || Number.isNaN(resFin.getTime())) continue;

    const devIso = normalizeDay(dev);
    const resIso = normalizeDay(resFin);
    const inicioNum = inicioMap.get(devIso);
    const finNum = finMap.get(resIso);
    if (inicioNum === undefined || finNum === undefined) continue;
    const diff = finNum - inicioNum;
    if (diff <= 0) continue;

    oldSum += diff;

    if (assignedTs === null) {
      omitted.push(h.id);
      continue;
    }
    const devTs = new Date(devIso).getTime();
    if (devTs < assignedTs) {
      omitted.push(h.id);
      continue;
    }

    newSum += diff;
  }

  const delta = newSum - oldSum;
  const nextDiasDescuento = Math.max(0, order.diasDescuento + delta);

  await prisma.$transaction([
    prisma.workOrder.update({
      where: { id: order.id },
      data: { diasDescuento: nextDiasDescuento }
    }),
    prisma.workOrderHistory.create({
      data: {
        workOrderId: order.id,
        toStatus: order.status,
        note: "Recalculo devoluciones",
        noteDetail: `DevolucionesAntes=${oldSum}; DevolucionesDespues=${newSum}; Ajuste=${delta}; Omitidas=${omitted.length}`,
        changedById: req.auth!.sub
      }
    })
  ]);

  res.json({
    code: order.code,
    before: { diasDescuento: order.diasDescuento, devoluciones: oldSum },
    after: { diasDescuento: nextDiasDescuento, devoluciones: newSum },
    delta,
    omitted
  });
});

workOrdersRouter.post("/purge-under", requireAuth, requireAdmin, async (req, res) => {
  const body = z
    .object({
      threshold: z.coerce.number().int().positive().optional(),
      dryRun: z.coerce.boolean().optional()
    })
    .safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY" });
    return;
  }

  const threshold = body.data.threshold ?? 3_000_000;
  const dryRun = body.data.dryRun ?? false;

  const matches = await prisma.$queryRaw<Array<{ id: string; code: string }>>`
    SELECT "id", "code"
    FROM "WorkOrder"
    WHERE NULLIF(regexp_replace("code", '\\D', '', 'g'), '')::bigint < ${threshold}
  `;

  const ids = matches.map((m) => m.id);
  const sample = matches.slice(0, 25).map((m) => m.code);

  if (dryRun) {
    res.json({ threshold, matched: ids.length, sample });
    return;
  }

  const deleted = await prisma.workOrder.deleteMany({
    where: { id: { in: ids } }
  });

  res.json({ threshold, matched: ids.length, deleted: deleted.count, sample });
});

workOrdersRouter.post("/purge-statuses", requireAuth, requireAdmin, async (req, res) => {
  const body = z
    .object({
      cancelado: z.coerce.boolean().optional(),
      solicitado: z.coerce.boolean().optional(),
      dryRun: z.coerce.boolean().optional()
    })
    .safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY" });
    return;
  }

  const cancelado = body.data.cancelado ?? true;
  const solicitado = body.data.solicitado ?? true;
  const dryRun = body.data.dryRun ?? false;

  const statuses: WorkOrderStatus[] = [];
  if (cancelado) statuses.push("CANCELLED");
  if (solicitado) statuses.push("CREATED");

  const matches = await prisma.workOrder.findMany({
    where: { status: { in: statuses } },
    select: { id: true, code: true, status: true },
    take: 25,
    orderBy: { updatedAt: "desc" }
  });

  const total = await prisma.workOrder.count({
    where: { status: { in: statuses } }
  });

  if (dryRun) {
    res.json({ statuses, matched: total, sample: matches });
    return;
  }

  const deleted = await prisma.workOrder.deleteMany({
    where: { status: { in: statuses } }
  });

  res.json({ statuses, matched: total, deleted: deleted.count, sample: matches });
});

workOrdersRouter.get("/", requireAuth, requirePermission("ORDERS"), async (req, res) => {
  const sortKeySchema = z.enum([
    "code",
    "status",
    "assignedAt",
    "fechaTentativaGestion",
    "gestorNombre",
    "oportunidad",
    "ansOportunidad",
    "diasGestion",
    "diasCumplimiento",
    "diasDevoluciones",
    "baremoAnsCalc",
    "diasEnel",
    "totalDiasDescuento",
    "diasPasados",
    "cumplimiento"
  ]);

  const querySchema = z.object({
    status: z.union([statusSchema, z.array(statusSchema)]).optional(),
    assigneeId: z.string().min(1).optional(),
    search: z.string().min(1).optional(),
    gestor: z.string().min(1).optional(),
    oportunidad: z.string().min(1).optional(),
    dateField: z.enum(["assignedAt", "gestionAt"]).optional(),
    dateStart: z.string().optional(),
    dateEnd: z.string().optional(),
    colorFilter: z.enum(["red", "green"]).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(500).optional(),
    sortKey: sortKeySchema.optional(),
    sortDir: z.enum(["asc", "desc"]).optional()
  });

  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_QUERY" });
    return;
  }

  const { status, assigneeId, search, gestor, oportunidad, dateField, dateStart, dateEnd, colorFilter } = parsed.data;
  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 100;
  const sortKey = parsed.data.sortKey ?? "fechaTentativaGestion";
  const sortDir = parsed.data.sortDir ?? "asc";

  // Sincronizar órdenes que tienen estadoSecundario "DEVUELTA" con el estado principal
  await prisma.workOrder.updateMany({
    where: { estadoSecundario: "DEVUELTA", status: { not: "DEVUELTA" } },
    data: { status: "DEVUELTA" }
  });

  const { inicioMap, finMap, finNumberToDate, maxFinNumber } = await loadCalendarMaps();

  const where: Prisma.WorkOrderWhereInput = {
    ...(assigneeId ? { assigneeId } : {}),
    ...(gestor ? { gestorNombre: { contains: gestor } } : {}),
    ...(oportunidad ? { oportunidad: { contains: oportunidad } } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search } },
            { title: { contains: search } },
            { gestorNombre: { contains: search } },
            { oportunidad: { contains: search } }
          ]
        }
      : {}),
  };

  if (status) {
    const statusArray: Status[] = Array.isArray(status) ? status : [status];
    const statusConditions: Prisma.WorkOrderWhereInput[] = [
      { status: { in: statusArray as unknown as WorkOrderStatus[] } }
    ];
    
    // Si el filtro incluye "DEVUELTA", buscamos también en estadoSecundario
    if (statusArray.includes("DEVUELTA")) {
      statusConditions.push({ estadoSecundario: "DEVUELTA" });
    }
    
    where.OR = statusConditions;
  }

  if (dateField && (dateStart || dateEnd)) {
    const range = {
      ...(dateStart ? { gte: new Date(dateStart) } : {}),
      ...(dateEnd ? { lte: new Date(dateEnd) } : {}),
    };
    if (dateField === "assignedAt") where.assignedAt = range;
    if (dateField === "gestionAt") where.gestionAt = range;
  }

  // Cuando el ordenamiento depende de cálculos (calendario/baremo/recorrido),
  // no se puede hacer un ORDER BY directo en la tabla sin pre-calcular columnas.
  // En esos casos, se calcula todo en memoria y luego se pagina.
  const computedSortKeys = new Set([
    "fechaTentativaGestion",
    "diasGestion",
    "diasCumplimiento",
    "diasDevoluciones",
    "baremoAnsCalc",
    "diasEnel",
    "totalDiasDescuento",
    "diasPasados",
    "cumplimiento"
  ]);
  const requiresFull = !!colorFilter || computedSortKeys.has(sortKey);

  const enrich = async (baseItems: WorkOrderListWithUsers[]): Promise<SortableListItem[]> => {
    const mapped = baseItems.map((it) => toListDto(it, inicioMap, finMap, finNumberToDate, maxFinNumber));

    const novedadDaysByOrderId = new Map<string, number>();
    const devolucionDaysByOrderId = new Map<string, number>();
    if (mapped.length > 0) {
      const orderIds = mapped.map((m) => m.id);
      const chunk = <T,>(arr: T[], size: number) => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };
      const idChunks = chunk(orderIds, 500);

      for (const group of idChunks) {
        const novedades = await prisma.novedad.findMany({
          where: { workOrderId: { in: group }, fechaFin: { not: null } },
          select: { workOrderId: true, fechaInicio: true, fechaFin: true }
        });

        for (const n of novedades) {
          const inicioNum = inicioMap.get(normalizeDay(n.fechaInicio));
          const finNum = n.fechaFin ? finMap.get(normalizeDay(n.fechaFin)) : undefined;
          if (inicioNum === undefined || finNum === undefined) continue;
          const diff = finNum - inicioNum;
          if (diff <= 0) continue;
          novedadDaysByOrderId.set(n.workOrderId, (novedadDaysByOrderId.get(n.workOrderId) ?? 0) + diff);
        }
      }

      for (const group of idChunks) {
        const devoluciones = await prisma.workOrderHistory.findMany({
          where: {
            workOrderId: { in: group },
            note: { contains: "Descuento por devolución" },
            fechaInicio: { not: null },
            fechaFin: { not: null }
          },
          select: { workOrderId: true, fechaInicio: true, fechaFin: true }
        });

        for (const d of devoluciones) {
          const inicioDate = d.fechaInicio ? new Date(d.fechaInicio) : null;
          const finDate = d.fechaFin ? new Date(d.fechaFin) : null;
          if (!inicioDate || !finDate) continue;
          if (Number.isNaN(inicioDate.getTime()) || Number.isNaN(finDate.getTime())) continue;
          const inicioNum = inicioMap.get(normalizeDay(inicioDate));
          const finNum = finMap.get(normalizeDay(finDate));
          if (inicioNum === undefined || finNum === undefined) continue;
          const diff = finNum - inicioNum;
          if (diff <= 0) continue;
          devolucionDaysByOrderId.set(d.workOrderId, (devolucionDaysByOrderId.get(d.workOrderId) ?? 0) + diff);
        }
      }
    }

    const codes = mapped.map((m) => m.code).filter(Boolean);
    if (codes.length === 0) {
      return mapped.map((m) => ({
        ...m,
        diasCumplimiento: novedadDaysByOrderId.get(m.id) ?? 0,
        diasDevoluciones: devolucionDaysByOrderId.get(m.id) ?? 0,
        baremoTotal: null,
        baremoAnsRef: null,
        baremoAnsCalc: null,
        diasEnel: 0
      }));
    }

    const chunkCodes = (arr: string[], size: number) => {
      const out: string[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    const baremos: Array<{ codigo: string; totalBarSum: number | null; ansRef: number | null; ansCalc: number | null }> = [];
    const enelSumMap = new Map<string, number>();
    const codeChunks = chunkCodes(codes, 500);

    for (const group of codeChunks) {
      const [b, g] = await Promise.all([
        prisma.actividadBaremo.findMany({
          where: { codigo: { in: group } },
          select: { codigo: true, totalBarSum: true, ansRef: true, ansCalc: true }
        }),
        prisma.recorridoIncremento.groupBy({
          by: ["orderCode", "nombreIncremento"],
          where: { orderCode: { in: group }, responsable: "ENEL", diasEnel: { not: null } },
          _sum: { diasEnel: true },
          _count: { diasEnel: true }
        })
      ]);
      baremos.push(...b);
      for (const row of g) {
        const sum = row._sum.diasEnel ?? 0;
        const count = row._count.diasEnel ?? 0;
        const finalSum = sum === 0 && count > 0 ? 1 : sum;
        enelSumMap.set(row.orderCode, (enelSumMap.get(row.orderCode) ?? 0) + finalSum);
      }
    }

    const baremoMap = new Map(baremos.map((b) => [b.codigo, b]));

    return mapped.map((m) => {
      const b = baremoMap.get(m.code);
      const baremoInt = typeof b?.ansCalc === "number" ? Math.round(b.ansCalc) : 0;
      const diasEnel = enelSumMap.get(m.code) ?? 0;
      const extraDescuento = baremoInt + diasEnel;
      const totalDiasDescuento = (m.totalDiasDescuento ?? 0) + extraDescuento;
      const rawDiasGestion = m.diasGestion == null ? null : m.diasGestion - extraDescuento;
      const diasGestion = rawDiasGestion == null ? null : Math.max(0, rawDiasGestion);
      const diasPasados = m.diasPasados == null ? null : m.diasPasados + extraDescuento;

      const assignedAt = m.assignedAt ? new Date(m.assignedAt as unknown as string | Date) : null;
      const assignedIso = assignedAt
        ? new Date(assignedAt.getFullYear(), assignedAt.getMonth(), assignedAt.getDate()).toISOString()
        : null;
      const assignedNum = assignedIso ? inicioMap.get(assignedIso) : undefined;

      const fechaTentativaGestion =
        !m.gestionAt && assignedNum !== undefined && m.ansOportunidad != null
          ? finNumberToDate.get(assignedNum + m.ansOportunidad + totalDiasDescuento) ?? m.fechaTentativaGestion
          : m.fechaTentativaGestion;

      const cumplimiento =
        m.status === "EXCLUDED"
          ? "Cumple"
          : diasPasados == null
            ? m.cumplimiento
            : diasPasados >= 0
              ? "Cumple"
              : "No cumple";

      return {
        ...m,
        diasCumplimiento: novedadDaysByOrderId.get(m.id) ?? 0,
        diasDevoluciones: devolucionDaysByOrderId.get(m.id) ?? 0,
        baremoTotal: b?.totalBarSum ?? null,
        baremoAnsRef: b?.ansRef ?? null,
        baremoAnsCalc: b?.ansCalc ?? null,
        diasEnel,
        totalDiasDescuento,
        diasGestion,
        diasPasados,
        fechaTentativaGestion,
        cumplimiento
      };
    });
  };

  const getSortValue = (it: SortableListItem) => {
    const parseDate = (v: string | Date | null | undefined) => {
      if (!v) return null;
      if (v instanceof Date) return v.getTime();
      const ms = Date.parse(v);
      return Number.isFinite(ms) ? ms : null;
    };
    switch (sortKey) {
      case "code":
        return it.code ?? null;
      case "status":
        return it.status ?? null;
      case "assignedAt":
        return parseDate(it.assignedAt);
      case "fechaTentativaGestion":
        return parseDate(it.fechaTentativaGestion ?? null);
      case "gestorNombre":
        return it.gestorNombre ?? null;
      case "oportunidad":
        return it.oportunidad ?? null;
      case "ansOportunidad":
        return it.ansOportunidad ?? null;
      case "diasGestion":
        return it.diasGestion ?? null;
      case "diasCumplimiento":
        return it.diasCumplimiento ?? null;
      case "diasDevoluciones":
        return it.diasDevoluciones ?? null;
      case "baremoAnsCalc":
        return it.baremoAnsCalc ?? null;
      case "diasEnel":
        return it.diasEnel ?? null;
      case "totalDiasDescuento":
        return it.totalDiasDescuento ?? null;
      case "diasPasados":
        return it.diasPasados ?? null;
      case "cumplimiento":
        return it.cumplimiento ?? null;
    }
  };

  const compare = (a: SortableListItem, b: SortableListItem) => {
    const av = getSortValue(a);
    const bv = getSortValue(b);
    if (av == null && bv == null) return String(a.code).localeCompare(String(b.code));
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
    const as = String(av).toLowerCase();
    const bs = String(bv).toLowerCase();
    return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
  };

  if (requiresFull) {
    const baseItems = await prisma.workOrder.findMany({
      where,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } }
      }
    });

    let mapped = await enrich(baseItems);

    if (colorFilter) {
      mapped = mapped.filter((it) => {
        if (it.cumplimiento === null) return false;
        const isRed = it.cumplimiento === "No cumple";
        return colorFilter === "red" ? isRed : !isRed;
      });
    }

    mapped.sort(compare);
    const total = mapped.length;
    const paged = mapped.slice((page - 1) * pageSize, page * pageSize);
    res.json({ items: paged, total, page, pageSize });
    return;
  }

  const orderBy: Prisma.WorkOrderOrderByWithRelationInput[] = [];
  const pushOrder = (field: keyof Prisma.WorkOrderOrderByWithRelationInput) => {
    orderBy.push({ [field]: sortDir } as Prisma.WorkOrderOrderByWithRelationInput);
    orderBy.push({ updatedAt: "desc" });
  };

  switch (sortKey) {
    case "code":
      pushOrder("code");
      break;
    case "status":
      pushOrder("status");
      break;
    case "assignedAt":
      pushOrder("assignedAt");
      break;
    case "gestorNombre":
      pushOrder("gestorNombre");
      break;
    case "oportunidad":
      pushOrder("oportunidad");
      break;
    case "ansOportunidad":
      pushOrder("ansOportunidad");
      break;
    default:
      orderBy.push({ updatedAt: "desc" });
      break;
  }

  const [total, pageItems] = await Promise.all([
    prisma.workOrder.count({ where }),
    prisma.workOrder.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } }
      }
    })
  ]);

  const mapped = await enrich(pageItems);
  res.json({ items: mapped, total, page, pageSize });
});

workOrdersRouter.post("/:id/novedades", requireAuth, requirePermission("ORDERS"), upload.single("soporte"), async (req, res) => {
  try {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const userId = req.auth!.sub;
    const { fechaInicio, fechaFin, descripcion, detalle } = req.body;

    const order = await prisma.workOrder.findUnique({ where: { id } });
    if (!order) {
      res.status(404).json({ error: "ORDER_NOT_FOUND" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "SOPORTE_REQUIRED" });
      return;
    }

    const dInicio = parseBogotaDateOnly(String(fechaInicio ?? ""));
    const dFin = fechaFin ? parseBogotaDateOnly(String(fechaFin)) : null;

    if (isNaN(dInicio.getTime()) || (dFin && isNaN(dFin.getTime()))) {
      res.status(400).json({ error: "INVALID_DATES" });
      return;
    }

    const { inicioMap, finMap } = await loadCalendarMaps();
    let diff = 0;
    if (dFin) {
      const inicioNum = inicioMap.get(normalizeDay(dInicio));
      const finNum = finMap.get(normalizeDay(dFin));
      if (inicioNum !== undefined && finNum !== undefined) {
        diff = finNum - inicioNum;
      }
    }

    // Crear novedad
    const novedad = await prisma.novedad.create({
      data: {
        workOrderId: id,
        fechaInicio: dInicio,
        fechaFin: dFin,
        descripcion,
        detalle,
        soportePath: `/uploads/novedades/${req.file.filename}`
      }
    });

    // Si no hay fecha fin, cambiar estado a ON_HOLD
    if (!fechaFin) {
      await prisma.workOrder.update({
        where: { id },
        data: {
          status: "ON_HOLD",
          lastStatusChangeAt: new Date()
        }
      });
    }

    // Actualizar orden con el descuento (solo si hay fecha fin)
    if (fechaFin && diff > 0) {
      await prisma.workOrder.update({
        where: { id },
        data: {
          diasDescuento: { increment: diff }
        }
      });
    }

    // Guardar en el historial la novedad propiamente dicha
    await prisma.workOrderHistory.create({
      data: {
        workOrderId: id,
        toStatus: fechaFin ? order.status : "ON_HOLD",
        note: descripcion,
        noteDetail: detalle,
        fechaInicio: fechaInicio,
        fechaFin: fechaFin || null,
        changedById: userId
      }
    });

    res.json({ novedad, diasDescontados: diff });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "UNKNOWN";
    res.status(500).json({ error: "INTERNAL_ERROR", details: msg });
  }
});

workOrdersRouter.patch("/:id/novedades/:novedadId", requireAuth, requirePermission("ORDERS"), async (req, res) => {
  try {
    const { id, novedadId } = z
      .object({ id: z.string().min(1), novedadId: z.string().min(1) })
      .parse(req.params);
    const userId = req.auth!.sub;
    const { fechaFin, detalle } = req.body;

    const novedad = await prisma.novedad.findUnique({ where: { id: novedadId } });
    if (!novedad) {
      res.status(404).json({ error: "NOVEDAD_NOT_FOUND" });
      return;
    }

    if (novedad.fechaFin) {
      res.status(400).json({ error: "NOVEDAD_ALREADY_CLOSED" });
      return;
    }

    const dFin = parseBogotaDateOnly(String(fechaFin ?? ""));
    if (isNaN(dFin.getTime())) {
      res.status(400).json({ error: "INVALID_DATE" });
      return;
    }

    const { inicioMap, finMap } = await loadCalendarMaps();
    const inicioNum = inicioMap.get(normalizeDay(novedad.fechaInicio));
    const finNum = finMap.get(normalizeDay(dFin));

    let diff = 0;
    if (inicioNum !== undefined && finNum !== undefined) {
      diff = finNum - inicioNum;
    }

    // Actualizar novedad
    const updatedNovedad = await prisma.novedad.update({
      where: { id: novedadId },
      data: {
        fechaFin: dFin,
        detalle: detalle || novedad.detalle
      }
    });

    const existingHistory = await prisma.workOrderHistory.findFirst({
      where: {
        workOrderId: id,
        note: novedad.descripcion,
        fechaFin: null
      },
      orderBy: { changedAt: "desc" }
    });

    if (existingHistory) {
      await prisma.workOrderHistory.update({
        where: { id: existingHistory.id },
        data: {
          fechaFin,
          noteDetail: detalle || novedad.detalle
        }
      });
    } else {
      await prisma.workOrderHistory.create({
        data: {
          workOrderId: id,
          toStatus: "ON_HOLD",
          note: novedad.descripcion,
          noteDetail: detalle || novedad.detalle,
          fechaInicio: novedad.fechaInicio.toISOString(),
          fechaFin,
          changedById: userId
        }
      });
    }

    // Actualizar descuento en la orden
    if (diff > 0) {
      await prisma.workOrder.update({
        where: { id },
        data: {
          diasDescuento: { increment: diff }
        }
      });
    }

    // Verificar si quedan otras novedades abiertas para esta orden
    const openNovedades = await prisma.novedad.findMany({
      where: {
        workOrderId: id,
        fechaFin: null
      }
    });

    // Si ya no hay novedades abiertas, retomar el estado anterior
    if (openNovedades.length === 0) {
      const lastHistory = await prisma.workOrderHistory.findFirst({
        where: { 
          workOrderId: id,
          toStatus: { not: "ON_HOLD" }
        },
        orderBy: { changedAt: "desc" }
      });

      const nextStatus = lastHistory?.toStatus || "ASSIGNED";

      await prisma.workOrder.update({
        where: { id },
        data: {
          status: nextStatus,
          lastStatusChangeAt: new Date()
        }
      });
    }

    res.json(updatedNovedad);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "UNKNOWN";
    res.status(500).json({ error: "INTERNAL_ERROR", details: msg });
  }
});

workOrdersRouter.post("/", requireAuth, requirePermission("ORDERS"), async (req, res) => {
  const bodySchema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    criticality: criticalitySchema.optional(),
    estimatedMinutes: z.number().int().positive().optional(),
    dueAt: z.string().datetime().optional(),
    assigneeId: z.string().min(1).optional()
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY" });
    return;
  }

  const { title, description, criticality, estimatedMinutes, dueAt, assigneeId } = parsed.data;
  const now = new Date();

  const initialStatus = assigneeId ? "ASSIGNED" : "CREATED";

  const created = await prisma.workOrder.create({
    data: {
      code: "OT-TMP",
      title,
      description: description ?? "",
      status: initialStatus,
      criticality: criticality ?? "MEDIUM",
      estimatedMinutes: estimatedMinutes ?? null,
      dueAt: dueAt ? new Date(dueAt) : null,
      createdById: req.auth!.sub,
      assigneeId: assigneeId ?? null,
      assignedAt: assigneeId ? now : null,
      lastStatusChangeAt: now,
      history: {
        create: {
          fromStatus: null,
          toStatus: initialStatus,
          changedById: req.auth!.sub
        }
      }
    },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      assignee: { select: { id: true, name: true, email: true } },
      novedades: true
    }
  });

  const code = `OT-${created.id.slice(-6).toUpperCase()}`;
  const updated = await prisma.workOrder.update({
    where: { id: created.id },
    data: { code },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      assignee: { select: { id: true, name: true, email: true } },
      novedades: true
    }
  });

  res.status(201).json(toDto(updated));
});

workOrdersRouter.get("/:id", requireAuth, requirePermission("ORDERS"), async (req, res) => {
  const paramsSchema = z.object({ id: z.string().min(1) });
  const parsed = paramsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_PARAMS" });
    return;
  }

  const item = await prisma.workOrder.findUnique({
    where: { id: parsed.data.id },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      assignee: { select: { id: true, name: true, email: true } },
      novedades: true,
      history: {
        orderBy: { changedAt: "asc" },
        include: { changedBy: { select: { id: true, name: true, email: true } } }
      }
    }
  });

  if (!item) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }

  // Obtener calendario para cálculos
  const calendar = await prisma.calendar.findMany();
  const inicioMap = new Map<string, number>();
  const finMap = new Map<string, number>();
  const finNumberToDate = new Map<number, string>();
  let maxFinNumber: number | undefined;
  calendar.forEach((c) => {
    const key = normalizeDay(c.date);
    inicioMap.set(key, c.dayNumber);
    const finNum = c.dayNumberFin ?? c.dayNumber;
    finMap.set(key, finNum);
    finNumberToDate.set(finNum, key);
    if (maxFinNumber === undefined || finNum > maxFinNumber) maxFinNumber = finNum;
  });

  const normalize = (dateStr: string | null) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return normalizeDay(d);
  };

  const dto = toDto(item, inicioMap, finMap, finNumberToDate, maxFinNumber);
  const baremo = await prisma.actividadBaremo.findUnique({
    where: { codigo: dto.code },
    select: { totalBarSum: true, ansRef: true, ansCalc: true }
  });

  const baremoInt = typeof baremo?.ansCalc === "number" ? Math.round(baremo.ansCalc) : 0;
  const enelGroup = await prisma.recorridoIncremento.groupBy({
    by: ["orderCode", "nombreIncremento"],
    where: { orderCode: dto.code, responsable: "ENEL", diasEnel: { not: null } },
    _sum: { diasEnel: true },
    _count: { diasEnel: true }
  });
  let diasEnel = 0;
  for (const g of enelGroup) {
    const sum = g._sum.diasEnel ?? 0;
    const count = g._count.diasEnel ?? 0;
    diasEnel += sum === 0 && count > 0 ? 1 : sum;
  }
  const extraDescuento = baremoInt + diasEnel;

  const totalDiasDescuento = (dto.totalDiasDescuento ?? 0) + extraDescuento;
  const rawDiasGestion = dto.diasGestion == null ? null : dto.diasGestion - extraDescuento;
  const diasGestion = rawDiasGestion == null ? null : Math.max(0, rawDiasGestion);
  const diasPasados = dto.diasPasados == null ? null : dto.diasPasados + extraDescuento;

  const assignedAt = dto.assignedAt ? new Date(dto.assignedAt as unknown as string | Date) : null;
  const assignedKey = assignedAt ? normalizeDay(assignedAt) : null;
  const assignedNum = assignedKey ? inicioMap.get(assignedKey) : undefined;

  const fechaTentativaGestion =
    !dto.gestionAt && assignedNum !== undefined && dto.ansOportunidad != null
      ? finNumberToDate.get(assignedNum + dto.ansOportunidad + totalDiasDescuento) ?? dto.fechaTentativaGestion
      : dto.fechaTentativaGestion;

  const cumplimiento =
    dto.status === "EXCLUDED"
      ? "Cumple"
      : diasPasados == null
        ? dto.cumplimiento
        : diasPasados >= 0
          ? "Cumple"
          : "No cumple";

  res.json({
    ...dto,
    baremoTotal: baremo?.totalBarSum ?? null,
    baremoAnsRef: baremo?.ansRef ?? null,
    baremoAnsCalc: baremo?.ansCalc ?? null,
    diasEnel,
    totalDiasDescuento,
    diasGestion,
    diasPasados,
    fechaTentativaGestion,
    cumplimiento,
    history: [
      ...item.history.map((h) => {
        let diasNovedad: number | null = null;
        const note = (h.note ?? "").toLowerCase();
        const detail = (h.noteDetail ?? "").toLowerCase();

        if (h.fechaInicio && h.fechaFin) {
          const inicioKey = normalize(h.fechaInicio);
          const finKey = normalize(h.fechaFin);
          const inicioNum = inicioKey ? inicioMap.get(inicioKey) : undefined;
          const finNum = finKey ? finMap.get(finKey) : undefined;
          if (inicioNum !== undefined && finNum !== undefined) {
            diasNovedad = finNum - inicioNum;
          }
        }

        if (diasNovedad === null) {
          if (note.includes("descuento por devolución") || note.includes("descuento por devolucion")) {
            const m = /descuento por devoluci[oó]n:\s*(\d+)\s*d[ií]as/i.exec(h.note ?? "");
            if (m?.[1]) {
              const n = parseInt(m[1], 10);
              if (Number.isFinite(n)) diasNovedad = n;
            }
          }
          if (note.includes("recorrido incrementos") || detail.includes("diasenel=")) {
            const m = /DiasENEL=([-]?\d+)/.exec(h.noteDetail ?? "");
            if (m?.[1]) {
              const n = parseInt(m[1], 10);
              if (Number.isFinite(n)) diasNovedad = n;
            }
          }
          if (note.includes("actividades baremo") || detail.includes("actividades baremo") || detail.includes("resultado=")) {
            const matches = [...(h.noteDetail ?? "").matchAll(/Resultado=([-]?\d+(?:\.\d+)?)/g)];
            if (matches.length > 0) {
              const last = matches[matches.length - 1]?.[1];
              const n = last ? parseFloat(last) : NaN;
              if (Number.isFinite(n)) diasNovedad = Math.round(n);
            }
          }
        }

      return {
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        note: h.note,
        noteDetail: h.noteDetail,
        fechaInicio: h.fechaInicio,
        fechaFin: h.fechaFin,
        diasNovedad,
        changedAt: h.changedAt,
        changedBy: h.changedBy
      };
      }),
      ...(
        await prisma.recorridoIncremento.findMany({
          where: { orderCode: dto.code, responsable: "ENEL" },
          orderBy: [{ fechaInicio: "asc" }],
          select: {
            id: true,
            nombreIncremento: true,
            estOrigenEstLlegada: true,
            responsable: true,
            csStatus: true,
            fechaInicio: true,
            fechaFin: true,
            diasEnel: true,
            updatedAt: true
          }
        })
      ).map((r) => ({
        id: `recorrido-${r.id}`,
        fromStatus: null,
        toStatus: dto.status,
        note: `Recorrido Incrementos - ${r.nombreIncremento}`,
        noteDetail: `Est_origen_Est_llegada=${r.estOrigenEstLlegada ?? ""}; Responsable=${r.responsable ?? ""}; CS_STATUS=${r.csStatus ?? ""}`,
        fechaInicio: r.fechaInicio.toISOString(),
        fechaFin: r.fechaFin ? r.fechaFin.toISOString() : null,
        diasNovedad: r.diasEnel ?? null,
        changedAt: r.updatedAt,
        changedBy: null
      }))
    ].sort((a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime())
  });
});

workOrdersRouter.patch("/:id", requireAuth, requirePermission("ORDERS"), async (req, res) => {
  const paramsSchema = z.object({ id: z.string().min(1) });
  const parsedParams = paramsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "INVALID_PARAMS" });
    return;
  }

  const bodySchema = z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    criticality: criticalitySchema.optional(),
    estimatedMinutes: z.number().int().positive().nullable().optional(),
    dueAt: z.string().datetime().nullable().optional(),
    assigneeId: z.string().min(1).nullable().optional()
  });

  const parsedBody = bodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "INVALID_BODY" });
    return;
  }

  const existing = await prisma.workOrder.findUnique({ where: { id: parsedParams.data.id } });
  if (!existing) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }
  if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
    res.status(409).json({ error: "IMMUTABLE_STATUS" });
    return;
  }

  const now = new Date();
  const patch = parsedBody.data;

  const nextAssigneeId =
    patch.assigneeId === undefined ? undefined : patch.assigneeId === null ? null : patch.assigneeId;

  const shouldAutoAssign =
    existing.status === "CREATED" && nextAssigneeId !== undefined && nextAssigneeId !== null;

  const updated = await prisma.workOrder.update({
    where: { id: existing.id },
    data: {
      title: patch.title,
      description: patch.description,
      criticality: patch.criticality,
      estimatedMinutes: patch.estimatedMinutes,
      dueAt: patch.dueAt === undefined ? undefined : patch.dueAt === null ? null : new Date(patch.dueAt),
      assigneeId: nextAssigneeId,
      ...(shouldAutoAssign
        ? {
            status: "ASSIGNED",
            assignedAt: now,
            lastStatusChangeAt: now,
            history: {
              create: {
                fromStatus: existing.status,
                toStatus: "ASSIGNED",
                changedById: req.auth!.sub
              }
            }
          }
        : nextAssigneeId !== undefined
          ? {
              assignedAt: nextAssigneeId ? now : null
            }
          : {})
    },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      assignee: { select: { id: true, name: true, email: true } },
      novedades: true
    }
  });

  res.json(toDto(updated));
});

workOrdersRouter.post("/:id/transition", requireAuth, requirePermission("ORDERS"), async (req, res) => {
  const paramsSchema = z.object({ id: z.string().min(1) });
  const parsedParams = paramsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "INVALID_PARAMS" });
    return;
  }

  const bodySchema = z.object({
    toStatus: statusSchema,
    note: z.string().optional()
  });

  const parsedBody = bodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "INVALID_BODY" });
    return;
  }

  const existing = await prisma.workOrder.findUnique({ where: { id: parsedParams.data.id } });
  if (!existing) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }

  const toStatus = parsedBody.data.toStatus;
  const fromStatus = existing.status;
  if (!canTransition(fromStatus, toStatus)) {
    res.status(409).json({ error: "INVALID_TRANSITION", fromStatus, toStatus });
    return;
  }

  if (toStatus === "ASSIGNED" && !existing.assigneeId) {
    res.status(409).json({ error: "ASSIGNEE_REQUIRED" });
    return;
  }

  const now = new Date();
  const updated = await prisma.workOrder.update({
    where: { id: existing.id },
    data: {
      status: toStatus,
      lastStatusChangeAt: now,
      assignedAt: toStatus === "ASSIGNED" && !existing.assignedAt ? now : existing.assignedAt,
      startedAt: toStatus === "IN_PROGRESS" && !existing.startedAt ? now : existing.startedAt,
      completedAt: toStatus === "COMPLETED" ? now : existing.completedAt,
      cancelledAt: toStatus === "CANCELLED" ? now : existing.cancelledAt,
      history: {
        create: {
          fromStatus,
          toStatus,
          note: parsedBody.data.note ?? "",
          changedById: req.auth!.sub
        }
      }
    },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      assignee: { select: { id: true, name: true, email: true } },
      novedades: true
    }
  });

  res.json(toDto(updated));
});
