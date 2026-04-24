import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../auth.js";

export const levantamientosRouter = Router();

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

type CalendarMaps = {
  inicioMap: Map<string, number>;
  finMap: Map<string, number>;
  finNumberToDate: Map<number, string>;
  maxFinNumber: number | undefined;
};

async function loadCalendarMaps(): Promise<CalendarMaps> {
  const calendar = await prisma.calendar.findMany({
    select: { date: true, dayNumber: true, dayNumberFin: true }
  });

  const inicioMap = new Map<string, number>();
  const finMap = new Map<string, number>();
  const finNumberToDate = new Map<number, string>();
  let maxFinNumber: number | undefined;

  for (const c of calendar) {
    const key = normalizeDay(c.date);
    inicioMap.set(key, c.dayNumber);
    const finNum = c.dayNumberFin ?? c.dayNumber;
    finMap.set(key, finNum);
    finNumberToDate.set(finNum, key);
    if (maxFinNumber === undefined || finNum > maxFinNumber) maxFinNumber = finNum;
  }

  return { inicioMap, finMap, finNumberToDate, maxFinNumber };
}

function diffByCalendar(
  inicioMap: Map<string, number>,
  finMap: Map<string, number>,
  start: Date | null,
  end: Date | null
) {
  if (!start || !end) return null;
  const startNum = inicioMap.get(normalizeDay(start));
  const endNum = finMap.get(normalizeDay(end));
  if (startNum === undefined || endNum === undefined) return null;
  return Math.max(0, endNum - startNum);
}

function colorByThreshold(value: number | null, threshold: number): "green" | "red" | null {
  if (value === null) return null;
  return value <= threshold ? "green" : "red";
}

levantamientosRouter.get("/", requireAuth, requirePermission("ORDERS"), async (req, res) => {
  const querySchema = z.object({
    search: z.string().min(1).optional(),
    estado: z.string().min(1).optional(),
    subestado: z.string().min(1).optional(),
    nivelTension: z.string().min(1).optional(),
    diasAsignaColor: z.enum(["red", "green"]).optional(),
    diasAprobacionPostColor: z.enum(["red", "green"]).optional(),
    diasCierreColor: z.enum(["red", "green"]).optional(),
    diasGestionTotalColor: z.enum(["red", "green"]).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(500).optional(),
    sortKey: z
      .enum([
        "orderCode",
        "nivelTension",
        "estado",
        "subestado",
        "fechaAsignacion",
        "fechaGestion",
        "diasAsigna",
        "diasAprobacionPost",
        "diasCierre",
        "diasGestionTotal"
      ])
      .optional(),
    sortDir: z.enum(["asc", "desc"]).optional()
  });

  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_QUERY" });
    return;
  }

  const {
    search,
    estado,
    subestado,
    nivelTension,
    diasAsignaColor,
    diasAprobacionPostColor,
    diasCierreColor,
    diasGestionTotalColor
  } = parsed.data;
  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 50;
  const sortKey = parsed.data.sortKey ?? "fechaAsignacion";
  const sortDir = parsed.data.sortDir ?? "desc";

  const where: Prisma.LevantamientoWhereInput = {
    ...(estado ? { estado: { contains: estado } } : {}),
    ...(subestado ? { subestado: { contains: subestado } } : {}),
    ...(nivelTension ? { nivelTension: { contains: nivelTension } } : {}),
    ...(search ? { orderCode: { contains: search } } : {})
  };

  const requiresComputedFilter = !!(
    diasAsignaColor ||
    diasAprobacionPostColor ||
    diasCierreColor ||
    diasGestionTotalColor ||
    ["diasAsigna", "diasAprobacionPost", "diasCierre", "diasGestionTotal", "fechaGestion"].includes(sortKey)
  );

  const { inicioMap, finMap, finNumberToDate } = await loadCalendarMaps();

  const THRESHOLD_DIAS_ASIGNA = 8;
  const THRESHOLD_DIAS_APROBACION_POST = 8;
  const THRESHOLD_DIAS_CIERRE = 8;
  const THRESHOLD_DIAS_GESTION_TOTAL = 8;

  const computeRow = (row: {
    orderCode: string;
    nivelTension: string | null;
    estado: string | null;
    subestado: string | null;
    fechaAsignacion: Date | null;
    fechaGestion: Date | null;
    fechaPrimerElemento: Date | null;
    fechaAprobacionPostproceso: Date | null;
  }, extra: { cierreSaitAt: Date | null }) => {
    const fechaGestionCalculada =
      !row.fechaGestion && row.fechaAsignacion
        ? (() => {
            const assignedNum = inicioMap.get(normalizeDay(row.fechaAsignacion));
            if (assignedNum === undefined) return null;
            const targetKey = finNumberToDate.get(assignedNum + 8) ?? null;
            return targetKey ? parseBogotaDateOnly(targetKey) : null;
          })()
        : null;
    const fechaGestionEfectiva = row.fechaGestion ?? fechaGestionCalculada;

    const diasAsigna = diffByCalendar(inicioMap, finMap, row.fechaAsignacion, row.fechaPrimerElemento);
    const diasGestionTotal = diffByCalendar(inicioMap, finMap, row.fechaAsignacion, fechaGestionEfectiva);
    const diasAprobacionPost = diffByCalendar(inicioMap, finMap, extra.cierreSaitAt, row.fechaAprobacionPostproceso);
    const diasCierre = diffByCalendar(inicioMap, finMap, row.fechaAprobacionPostproceso, fechaGestionEfectiva);

    const diasAsignaColorCalc = colorByThreshold(diasAsigna, THRESHOLD_DIAS_ASIGNA);
    const diasAprobacionPostColorCalc = colorByThreshold(diasAprobacionPost, THRESHOLD_DIAS_APROBACION_POST);
    const diasCierreColorCalc = colorByThreshold(diasCierre, THRESHOLD_DIAS_CIERRE);
    const diasGestionTotalColorCalc = colorByThreshold(diasGestionTotal, THRESHOLD_DIAS_GESTION_TOTAL);

    return {
      orderCode: row.orderCode,
      nivelTension: row.nivelTension,
      estado: row.estado,
      subestado: row.subestado,
      fechaAsignacion: row.fechaAsignacion,
      fechaGestion: fechaGestionEfectiva,
      fechaGestionCalculada: row.fechaGestion ? null : fechaGestionCalculada,
      diasAsigna,
      diasAprobacionPost,
      diasCierre,
      diasGestionTotal,
      diasAsignaColor: diasAsignaColorCalc,
      diasAprobacionPostColor: diasAprobacionPostColorCalc,
      diasCierreColor: diasCierreColorCalc,
      diasGestionTotalColor: diasGestionTotalColorCalc
    };
  };

  if (!requiresComputedFilter) {
    const orderBy =
      sortKey === "orderCode"
        ? { orderCode: sortDir }
        : sortKey === "nivelTension"
          ? { nivelTension: sortDir }
          : sortKey === "estado"
            ? { estado: sortDir }
            : sortKey === "subestado"
              ? { subestado: sortDir }
              : { fechaAsignacion: sortDir };

    const [total, pageItems] = await Promise.all([
      prisma.levantamiento.count({ where }),
      prisma.levantamiento.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          orderCode: true,
          nivelTension: true,
          estado: true,
          subestado: true,
          fechaAsignacion: true,
          fechaGestion: true,
          fechaPrimerElemento: true,
          fechaAprobacionPostproceso: true
        }
      })
    ]);

    const codes = pageItems.map((r) => r.orderCode);
    const wo = codes.length
      ? await prisma.workOrder.findMany({
          where: { code: { in: codes } },
          select: { id: true, code: true }
        })
      : [];
    const idToCode = new Map(wo.map((o) => [o.id, o.code]));
    const histories = wo.length
      ? await prisma.workOrderHistory.findMany({
          where: { workOrderId: { in: wo.map((o) => o.id) }, note: "Cierre SAIT", fechaInicio: { not: null } },
          select: { workOrderId: true, fechaInicio: true, changedAt: true },
          orderBy: { changedAt: "desc" }
        })
      : [];
    const cierreSaitByCode = new Map<string, Date>();
    for (const h of histories) {
      const code = idToCode.get(h.workOrderId);
      if (!code) continue;
      if (cierreSaitByCode.has(code)) continue;
      const d = parseBogotaDateOnly(String(h.fechaInicio ?? ""));
      if (!Number.isNaN(d.getTime())) cierreSaitByCode.set(code, d);
    }

    const items = pageItems.map((r) => computeRow(r, { cierreSaitAt: cierreSaitByCode.get(r.orderCode) ?? null }));
    res.json({ items, total, page, pageSize });
    return;
  }

  const base = await prisma.levantamiento.findMany({
    where,
    select: {
      orderCode: true,
      nivelTension: true,
      estado: true,
      subestado: true,
      fechaAsignacion: true,
      fechaGestion: true,
      fechaPrimerElemento: true,
      fechaAprobacionPostproceso: true
    }
  });

  const codes = base.map((r) => r.orderCode);
  const wo = codes.length
    ? await prisma.workOrder.findMany({
        where: { code: { in: codes } },
        select: { id: true, code: true }
      })
    : [];
  const idToCode = new Map(wo.map((o) => [o.id, o.code]));
  const histories = wo.length
    ? await prisma.workOrderHistory.findMany({
        where: { workOrderId: { in: wo.map((o) => o.id) }, note: "Cierre SAIT", fechaInicio: { not: null } },
        select: { workOrderId: true, fechaInicio: true, changedAt: true },
        orderBy: { changedAt: "desc" }
      })
    : [];
  const cierreSaitByCode = new Map<string, Date>();
  for (const h of histories) {
    const code = idToCode.get(h.workOrderId);
    if (!code) continue;
    if (cierreSaitByCode.has(code)) continue;
    const d = parseBogotaDateOnly(String(h.fechaInicio ?? ""));
    if (!Number.isNaN(d.getTime())) cierreSaitByCode.set(code, d);
  }

  let computed = base.map((r) => computeRow(r, { cierreSaitAt: cierreSaitByCode.get(r.orderCode) ?? null }));

  const applyColorFilter = (key: "diasAsignaColor" | "diasAprobacionPostColor" | "diasCierreColor" | "diasGestionTotalColor", val?: "red" | "green") => {
    if (!val) return;
    computed = computed.filter((r) => r[key] === val);
  };

  applyColorFilter("diasAsignaColor", diasAsignaColor);
  applyColorFilter("diasAprobacionPostColor", diasAprobacionPostColor);
  applyColorFilter("diasCierreColor", diasCierreColor);
  applyColorFilter("diasGestionTotalColor", diasGestionTotalColor);

  const parseDateMs = (v: Date | null) => (v ? v.getTime() : null);

  computed.sort((a, b) => {
    const dir = sortDir === "desc" ? -1 : 1;
    const va =
      sortKey === "orderCode"
        ? a.orderCode
        : sortKey === "nivelTension"
          ? (a.nivelTension ?? "")
          : sortKey === "estado"
            ? (a.estado ?? "")
            : sortKey === "subestado"
              ? (a.subestado ?? "")
              : sortKey === "fechaAsignacion"
                ? (parseDateMs(a.fechaAsignacion) ?? 0)
                : sortKey === "fechaGestion"
                  ? (parseDateMs(a.fechaGestion) ?? 0)
                  : sortKey === "diasAsigna"
                    ? (a.diasAsigna ?? -1)
                    : sortKey === "diasAprobacionPost"
                      ? (a.diasAprobacionPost ?? -1)
                      : sortKey === "diasCierre"
                        ? (a.diasCierre ?? -1)
                        : (a.diasGestionTotal ?? -1);
    const vb =
      sortKey === "orderCode"
        ? b.orderCode
        : sortKey === "nivelTension"
          ? (b.nivelTension ?? "")
          : sortKey === "estado"
            ? (b.estado ?? "")
            : sortKey === "subestado"
              ? (b.subestado ?? "")
              : sortKey === "fechaAsignacion"
                ? (parseDateMs(b.fechaAsignacion) ?? 0)
                : sortKey === "fechaGestion"
                  ? (parseDateMs(b.fechaGestion) ?? 0)
                  : sortKey === "diasAsigna"
                    ? (b.diasAsigna ?? -1)
                    : sortKey === "diasAprobacionPost"
                      ? (b.diasAprobacionPost ?? -1)
                      : sortKey === "diasCierre"
                        ? (b.diasCierre ?? -1)
                        : (b.diasGestionTotal ?? -1);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });

  const total = computed.length;
  const start = (page - 1) * pageSize;
  const items = computed.slice(start, start + pageSize);
  res.json({ items, total, page, pageSize });
});
