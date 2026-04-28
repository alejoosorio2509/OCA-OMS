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

function diffByCalendarEndNow(
  inicioMap: Map<string, number>,
  finMap: Map<string, number>,
  start: Date | null,
  end: Date | null,
  now: Date
) {
  if (!start) return null;
  return diffByCalendar(inicioMap, finMap, start, end ?? now);
}

function colorByThreshold(value: number | null, threshold: number): "green" | "yellow" | "red" | null {
  if (value === null) return null;
  if (value > threshold) return "red";
  const warnWindow = 2;
  return value > threshold - warnWindow ? "yellow" : "green";
}

levantamientosRouter.get("/nivel-tension", requireAuth, requirePermission("ORDERS"), async (_req, res) => {
  const rows = await prisma.levantamiento.findMany({
    select: { nivelTension: true }
  });
  const set = new Set<string>();
  for (const r of rows) {
    const v = (r.nivelTension ?? "").trim();
    if (v) set.add(v);
  }
  res.json(Array.from(set).sort((a, b) => a.localeCompare(b)));
});

levantamientosRouter.get("/metrics", requireAuth, requirePermission("ORDERS"), async (req, res) => {
  const querySchema = z.object({
    search: z.string().min(1).optional(),
    nivelTension: z.string().min(1).optional(),
    cuadrilla: z.string().min(1).optional(),
    asignacionStart: z.string().min(1).optional(),
    asignacionEnd: z.string().min(1).optional()
  });

  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_QUERY" });
    return;
  }

  const { search, nivelTension, cuadrilla, asignacionStart, asignacionEnd } = parsed.data;

  const parseDay = (value: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) return null;
    const d = parseBogotaDateOnly(value.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const startDate = asignacionStart ? parseDay(asignacionStart) : null;
  const endDate = asignacionEnd ? parseDay(asignacionEnd) : null;
  if ((asignacionStart && !startDate) || (asignacionEnd && !endDate)) {
    res.status(400).json({ error: "INVALID_DATE_FILTER" });
    return;
  }
  const endExclusive = endDate ? new Date(endDate.getTime() + 24 * 60 * 60 * 1000) : null;

  const where: Prisma.LevantamientoWhereInput = {
    ...(nivelTension ? { nivelTension: { contains: nivelTension } } : {}),
    ...(cuadrilla ? { cuadrilla: { equals: cuadrilla } } : {}),
    ...(search ? { orderCode: { contains: search } } : {}),
    ...(startDate || endExclusive
      ? {
          fechaPrimerElemento: {
            ...(startDate ? { gte: startDate } : {}),
            ...(endExclusive ? { lt: endExclusive } : {})
          }
        }
      : {})
  };

  const [rows, calendar] = await Promise.all([
    prisma.levantamiento.findMany({
      where,
      select: {
        orderCode: true,
        fechaAsignacion: true,
        fechaPrimerElemento: true,
        fechaEntregaPostproceso: true,
        fechaAprobacionPostproceso: true,
        fechaGestion: true
      }
    }),
    prisma.calendar.findMany({ select: { date: true, dayNumber: true, dayNumberFin: true } })
  ]);

  const { inicioMap, finMap } = (() => {
    const inicioMap = new Map<string, number>();
    const finMap = new Map<string, number>();
    for (const c of calendar) {
      const key = normalizeDay(c.date);
      inicioMap.set(key, c.dayNumber);
      finMap.set(key, c.dayNumberFin ?? c.dayNumber);
    }
    return { inicioMap, finMap };
  })();

  const codes = rows.map((r) => r.orderCode);
  const novedades = codes.length
    ? await prisma.novedad.findMany({
        where: { workOrder: { code: { in: codes } }, fechaFin: { not: null } },
        select: { workOrder: { select: { code: true } }, fechaInicio: true, fechaFin: true }
      })
    : [];
  const novedadSumByCode = new Map<string, number>();
  for (const n of novedades) {
    const iniNum = inicioMap.get(normalizeDay(n.fechaInicio));
    const finNum = n.fechaFin ? finMap.get(normalizeDay(n.fechaFin)) : undefined;
    if (iniNum !== undefined && finNum !== undefined) {
      const diff = finNum - iniNum;
      if (diff >= 0) novedadSumByCode.set(n.workOrder.code, (novedadSumByCode.get(n.workOrder.code) ?? 0) + (diff + 1));
    }
  }

  const wo = codes.length
    ? await prisma.workOrder.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } })
    : [];
  const idToCode = new Map(wo.map((o) => [o.id, o.code]));
  const histories = wo.length
    ? await prisma.workOrderHistory.findMany({
        where: { workOrderId: { in: wo.map((o) => o.id) }, note: "Cierre SAIT", fechaInicio: { not: null } },
        select: { workOrderId: true, fechaInicio: true, changedAt: true },
        orderBy: { changedAt: "desc" }
      })
    : [];
  const entregaByCode = new Map<string, Date>();
  for (const h of histories) {
    const code = idToCode.get(h.workOrderId);
    if (!code) continue;
    if (entregaByCode.has(code)) continue;
    const d = parseBogotaDateOnly(String(h.fechaInicio ?? ""));
    if (!Number.isNaN(d.getTime())) entregaByCode.set(code, d);
  }

  const now = new Date();

  let asignacion = 0;
  let primerElemento = 0;
  let entregaPostproceso = 0;
  let aprobacionPostproceso = 0;
  let gestion = 0;
  let aprobacionCumple = 0;
  let aprobacionNoCumple = 0;

  for (const r of rows) {
    const entrega = r.fechaEntregaPostproceso ?? entregaByCode.get(r.orderCode) ?? null;
    const diasNovedades = novedadSumByCode.get(r.orderCode) ?? 0;
    const etapa =
      r.fechaGestion
        ? "GESTION"
        : r.fechaAprobacionPostproceso
          ? "APROBACION"
          : entrega
            ? "ENTREGA"
            : r.fechaPrimerElemento
              ? "PRIMER_ELEMENTO"
              : r.fechaAsignacion
                ? "ASIGNACION"
                : "SIN";

    if (etapa === "ASIGNACION") asignacion++;
    if (etapa === "PRIMER_ELEMENTO") primerElemento++;
    if (etapa === "ENTREGA") entregaPostproceso++;
    if (etapa === "APROBACION") aprobacionPostproceso++;
    if (etapa === "GESTION") gestion++;

    const aprobEndNum = finMap.get(normalizeDay(r.fechaAprobacionPostproceso ?? now));
    const baseNum = r.fechaPrimerElemento ? inicioMap.get(normalizeDay(r.fechaPrimerElemento)) : undefined;
    const diasRaw = entrega
      ? diffByCalendarEndNow(inicioMap, finMap, entrega, r.fechaAprobacionPostproceso, now)
      : baseNum !== undefined && aprobEndNum !== undefined
        ? Math.max(0, aprobEndNum - (baseNum + 3))
        : null;
    const dias = diasRaw === null ? null : Math.max(0, diasRaw - diasNovedades);
    if (dias !== null) {
      if (dias <= 3) aprobacionCumple++;
      else aprobacionNoCumple++;
    }
  }

  const total = rows.length;
  const denomAprob = aprobacionCumple + aprobacionNoCumple;
  const aprobacionPct = denomAprob ? Math.round((aprobacionCumple / denomAprob) * 100) : 0;
  res.json({
    total,
    asignacion,
    primerElemento,
    entregaPostproceso,
    aprobacionPostproceso,
    gestion,
    aprobacionCumple,
    aprobacionNoCumple,
    aprobacionPct
  });
});

levantamientosRouter.get("/", requireAuth, requirePermission("ORDERS"), async (req, res) => {
  const querySchema = z.object({
    search: z.string().min(1).optional(),
    nivelTension: z.string().min(1).optional(),
    cuadrilla: z.string().min(1).optional(),
    etapa: z.enum(["ASIGNACION", "PRIMER_ELEMENTO", "ENTREGA_POSTPROCESO", "APROBACION_POSTPROCESO", "GESTION"]).optional(),
    asignacionStart: z.string().min(1).optional(),
    asignacionEnd: z.string().min(1).optional(),
    diasAsignaColor: z.enum(["red", "yellow", "green"]).optional(),
    diasAprobacionPostColor: z.enum(["red", "yellow", "green"]).optional(),
    diasCierreColor: z.enum(["red", "yellow", "green"]).optional(),
    diasGestionTotalColor: z.enum(["red", "yellow", "green"]).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(500).optional(),
    sortKey: z
      .enum([
        "orderCode",
        "nivelTension",
        "estado",
        "subestado",
        "fechaAsignacion",
        "fechaPrimerElemento",
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
    nivelTension,
    cuadrilla,
    etapa,
    asignacionStart,
    asignacionEnd,
    diasAsignaColor,
    diasAprobacionPostColor,
    diasCierreColor,
    diasGestionTotalColor
  } = parsed.data;
  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 50;
  const sortKey = parsed.data.sortKey ?? "fechaPrimerElemento";
  const sortDir = parsed.data.sortDir ?? "desc";

  const parseDay = (value: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) return null;
    const d = parseBogotaDateOnly(value.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const startDate = asignacionStart ? parseDay(asignacionStart) : null;
  const endDate = asignacionEnd ? parseDay(asignacionEnd) : null;
  if ((asignacionStart && !startDate) || (asignacionEnd && !endDate)) {
    res.status(400).json({ error: "INVALID_DATE_FILTER" });
    return;
  }
  const endExclusive = endDate ? new Date(endDate.getTime() + 24 * 60 * 60 * 1000) : null;

  const where: Prisma.LevantamientoWhereInput = {
    ...(nivelTension ? { nivelTension: { contains: nivelTension } } : {}),
    ...(cuadrilla ? { cuadrilla: { equals: cuadrilla } } : {}),
    ...(search ? { orderCode: { contains: search } } : {}),
    ...(startDate || endExclusive
      ? {
          fechaPrimerElemento: {
            ...(startDate ? { gte: startDate } : {}),
            ...(endExclusive ? { lt: endExclusive } : {})
          }
        }
      : {})
  };

  const requiresComputedFilter = !!(
    etapa ||
    diasAsignaColor ||
    diasAprobacionPostColor ||
    diasCierreColor ||
    diasGestionTotalColor ||
    ["diasAsigna", "diasAprobacionPost", "diasCierre", "diasGestionTotal", "fechaGestion"].includes(sortKey)
  );

  const { inicioMap, finMap, finNumberToDate } = await loadCalendarMaps();

  const THRESHOLD_DIAS_ASIGNA = 4;
  const THRESHOLD_DIAS_APROBACION_POST = 3;
  const THRESHOLD_DIAS_CIERRE = 8;
  const THRESHOLD_DIAS_GESTION_TOTAL = 8;

  const now = new Date();

  const computeRow = (row: {
    orderCode: string;
    nivelTension: string | null;
    estado: string | null;
    subestado: string | null;
    cuadrilla: string | null;
    fechaAprobacionValorizacionSt: Date | null;
    fechaAsignacion: Date | null;
    fechaEntregaPostproceso: Date | null;
    fechaGestion: Date | null;
    fechaPrimerElemento: Date | null;
    fechaAprobacionPostproceso: Date | null;
  }, extra: { cierreSaitAt: Date | null; diasNovedades: number }) => {
    const baseNum = row.fechaPrimerElemento ? inicioMap.get(normalizeDay(row.fechaPrimerElemento)) : undefined;
    const diasNovedades = extra.diasNovedades;
    const vencimientoNum = baseNum !== undefined ? baseNum + 8 + diasNovedades : undefined;
    const fechaGestionCalculada =
      !row.fechaGestion && vencimientoNum !== undefined
        ? (() => {
            const targetKey = finNumberToDate.get(vencimientoNum) ?? null;
            return targetKey ? parseBogotaDateOnly(targetKey) : null;
          })()
        : null;
    const fechaGestionEfectiva = row.fechaGestion ?? fechaGestionCalculada;

    const applyNovedades = (v: number | null) => (v === null ? null : Math.max(0, v - diasNovedades));

    const diasAsignaRaw = diffByCalendarEndNow(
      inicioMap,
      finMap,
      row.fechaAprobacionValorizacionSt ?? null,
      row.fechaAsignacion,
      now
    );
    const diasAsigna = applyNovedades(diasAsignaRaw);
    const refDate = row.fechaGestion ?? now;
    const refNum = finMap.get(normalizeDay(refDate));
    const diasGestionTotal = vencimientoNum !== undefined && refNum !== undefined ? vencimientoNum - refNum : null;
    const entregaPost = row.fechaEntregaPostproceso ?? extra.cierreSaitAt ?? null;
    const aprobEndNum = finMap.get(normalizeDay(row.fechaAprobacionPostproceso ?? now));
    const diasAprobacionPostRaw =
      entregaPost
        ? diffByCalendarEndNow(inicioMap, finMap, entregaPost, row.fechaAprobacionPostproceso, now)
        : baseNum !== undefined && aprobEndNum !== undefined
          ? Math.max(0, aprobEndNum - (baseNum + 3))
          : null;
    const diasAprobacionPost = applyNovedades(diasAprobacionPostRaw);
    const cierreStartNum = row.fechaAprobacionPostproceso ? inicioMap.get(normalizeDay(row.fechaAprobacionPostproceso)) : undefined;
    const cierreEndNum = row.fechaGestion ? finMap.get(normalizeDay(row.fechaGestion)) : baseNum !== undefined ? baseNum + 8 : undefined;
    const diasCierreRaw =
      cierreStartNum !== undefined && cierreEndNum !== undefined ? Math.max(0, cierreEndNum - cierreStartNum) : null;
    const diasCierre = applyNovedades(diasCierreRaw);

    const diasAsignaColorCalc = colorByThreshold(diasAsigna, THRESHOLD_DIAS_ASIGNA);
    const diasAprobacionPostColorCalc = colorByThreshold(diasAprobacionPost, THRESHOLD_DIAS_APROBACION_POST);
    const diasCierreColorCalc = colorByThreshold(diasCierre, THRESHOLD_DIAS_CIERRE);
    const diasGestionTotalColorCalc =
      diasGestionTotal === null ? null : diasGestionTotal < 0 ? "red" : diasGestionTotal <= 2 ? "yellow" : "green";

    return {
      orderCode: row.orderCode,
      nivelTension: row.nivelTension,
      estado: row.estado,
      subestado: row.subestado,
      cuadrilla: row.cuadrilla,
      fechaAsignacion: row.fechaAsignacion,
      fechaPrimerElemento: row.fechaPrimerElemento,
      fechaGestion: fechaGestionEfectiva,
      fechaGestionCalculada: row.fechaGestion ? null : fechaGestionCalculada,
      diasAsigna,
      diasAprobacionPost,
      diasCierre,
      diasNovedades,
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
              : sortKey === "fechaPrimerElemento"
                ? { fechaPrimerElemento: sortDir }
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
          cuadrilla: true,
          fechaAprobacionValorizacionSt: true,
          fechaAsignacion: true,
          fechaEntregaPostproceso: true,
          fechaGestion: true,
          fechaPrimerElemento: true,
          fechaAprobacionPostproceso: true
        }
      })
    ]);

    const codes = pageItems.map((r) => r.orderCode);
    const userId = req.auth!.sub;
    if (codes.length) {
      const existingCodes = await prisma.workOrder.findMany({ where: { code: { in: codes } }, select: { code: true } });
      const existingSet = new Set(existingCodes.map((r) => r.code));
      const missing = codes.filter((c) => !existingSet.has(c));
      if (missing.length) {
        await prisma.workOrder.createMany({
          data: missing.map((code) => ({ code, title: `OT ${code}`, status: "CREATED", createdById: userId })),
          skipDuplicates: true
        });
      }
    }

    const wo = codes.length
      ? await prisma.workOrder.findMany({
          where: { code: { in: codes } },
          select: { id: true, code: true, status: true, estadoSecundario: true }
        })
      : [];
    const woByCode = new Map(wo.map((o) => [o.code, o]));
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

    const novedades = codes.length
      ? await prisma.novedad.findMany({
          where: { workOrder: { code: { in: codes } }, fechaFin: { not: null } },
          select: { workOrder: { select: { code: true } }, fechaInicio: true, fechaFin: true }
        })
      : [];
    const novedadSumByCode = new Map<string, number>();
    for (const n of novedades) {
      const iniNum = inicioMap.get(normalizeDay(n.fechaInicio));
      const finNum = n.fechaFin ? finMap.get(normalizeDay(n.fechaFin)) : undefined;
      if (iniNum !== undefined && finNum !== undefined) {
        const diff = finNum - iniNum;
        if (diff >= 0) novedadSumByCode.set(n.workOrder.code, (novedadSumByCode.get(n.workOrder.code) ?? 0) + (diff + 1));
      }
    }

    const items = pageItems.map((r) => {
      const computed = computeRow(r, {
        cierreSaitAt: cierreSaitByCode.get(r.orderCode) ?? null,
        diasNovedades: novedadSumByCode.get(r.orderCode) ?? 0
      });
      const w = woByCode.get(r.orderCode) ?? null;
      return {
        ...computed,
        workOrderId: w?.id ?? null,
        workOrderStatus: w?.status ?? null,
        estadoSecundario: w?.estadoSecundario ?? null
      };
    });
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
      cuadrilla: true,
      fechaAprobacionValorizacionSt: true,
      fechaAsignacion: true,
      fechaEntregaPostproceso: true,
      fechaGestion: true,
      fechaPrimerElemento: true,
      fechaAprobacionPostproceso: true
    }
  });

  const codes = base.map((r) => r.orderCode);
  const wo = codes.length
    ? await prisma.workOrder.findMany({
        where: { code: { in: codes } },
        select: { id: true, code: true, status: true, estadoSecundario: true }
      })
    : [];
  const woByCode = new Map(wo.map((o) => [o.code, o]));
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

  const etapaByCode = new Map<string, "ASIGNACION" | "PRIMER_ELEMENTO" | "ENTREGA_POSTPROCESO" | "APROBACION_POSTPROCESO" | "GESTION" | "SIN">();
  for (const r of base) {
    const entrega = r.fechaEntregaPostproceso ?? cierreSaitByCode.get(r.orderCode) ?? null;
    const e =
      r.fechaGestion
        ? "GESTION"
        : r.fechaAprobacionPostproceso
          ? "APROBACION_POSTPROCESO"
          : entrega
            ? "ENTREGA_POSTPROCESO"
            : r.fechaPrimerElemento
              ? "PRIMER_ELEMENTO"
              : r.fechaAsignacion
                ? "ASIGNACION"
                : "SIN";
    etapaByCode.set(r.orderCode, e);
  }

  const novedades = codes.length
    ? await prisma.novedad.findMany({
        where: { workOrder: { code: { in: codes } }, fechaFin: { not: null } },
        select: { workOrder: { select: { code: true } }, fechaInicio: true, fechaFin: true }
      })
    : [];
  const novedadSumByCode = new Map<string, number>();
  for (const n of novedades) {
    const iniNum = inicioMap.get(normalizeDay(n.fechaInicio));
    const finNum = n.fechaFin ? finMap.get(normalizeDay(n.fechaFin)) : undefined;
    if (iniNum !== undefined && finNum !== undefined) {
      const diff = finNum - iniNum;
      if (diff >= 0) novedadSumByCode.set(n.workOrder.code, (novedadSumByCode.get(n.workOrder.code) ?? 0) + (diff + 1));
    }
  }

  let computed = base.map((r) => {
    const row = computeRow(r, {
      cierreSaitAt: cierreSaitByCode.get(r.orderCode) ?? null,
      diasNovedades: novedadSumByCode.get(r.orderCode) ?? 0
    });
    const w = woByCode.get(r.orderCode) ?? null;
    return {
      ...row,
      workOrderId: w?.id ?? null,
      workOrderStatus: w?.status ?? null,
      estadoSecundario: w?.estadoSecundario ?? null
    };
  });

  if (etapa) {
    computed = computed.filter((r) => etapaByCode.get(r.orderCode) === etapa);
  }

  const applyColorFilter = (
    key: "diasAsignaColor" | "diasAprobacionPostColor" | "diasCierreColor" | "diasGestionTotalColor",
    val?: "red" | "yellow" | "green"
  ) => {
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
                : sortKey === "fechaPrimerElemento"
                  ? (parseDateMs(a.fechaPrimerElemento ?? null) ?? 0)
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
                : sortKey === "fechaPrimerElemento"
                  ? (parseDateMs(b.fechaPrimerElemento ?? null) ?? 0)
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
  const userId = req.auth!.sub;
  const pageCodes = items.map((r) => r.orderCode);
  if (pageCodes.length) {
    const existingCodes = await prisma.workOrder.findMany({ where: { code: { in: pageCodes } }, select: { code: true } });
    const existingSet = new Set(existingCodes.map((r) => r.code));
    const missing = pageCodes.filter((c) => !existingSet.has(c));
    if (missing.length) {
      await prisma.workOrder.createMany({
        data: missing.map((code) => ({ code, title: `OT ${code}`, status: "CREATED", createdById: userId })),
        skipDuplicates: true
      });
    }
    const wo = await prisma.workOrder.findMany({
      where: { code: { in: pageCodes } },
      select: { id: true, code: true, status: true, estadoSecundario: true }
    });
    const woByCode = new Map(wo.map((o) => [o.code, o]));
    const hydrated = items.map((r) => {
      const w = woByCode.get(r.orderCode) ?? null;
      return { ...r, workOrderId: w?.id ?? null, workOrderStatus: w?.status ?? null, estadoSecundario: w?.estadoSecundario ?? null };
    });
    res.json({ items: hydrated, total, page, pageSize });
    return;
  }
  res.json({ items, total, page, pageSize });
});
