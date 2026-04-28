import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../auth.js";
import type { Prisma, WorkOrderStatus } from "@prisma/client";

export const exportsRouter = Router();

const dateRangeSchema = z.object({
  dateStart: z.string().optional(),
  dateEnd: z.string().optional()
});

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

function toDateStart(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function toDateEnd(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function toCsv(headers: string[], rows: unknown[][]) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return `\ufeff${lines.join("\n")}\n`;
}

const BOGOTA_TZ = "America/Bogota";
const bogotaDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: BOGOTA_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

function normalizeDateStr(date: Date) {
  return bogotaDateFmt.format(date);
}

function calendarKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildCalendarMaps(calendar: { date: Date; dayNumber: number; dayNumberFin: number | null }[]) {
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

function computeDerived(input: {
  assignedAt: Date | null;
  gestionAt: Date | null;
  ansOportunidad: number | null;
  diasDescuento: number;
}, inicioMap: Map<string, number>, finMap: Map<string, number>, finNumberToDate: Map<number, string>, maxFinNumber?: number) {
  const now = new Date();
  const nowNum = finMap.get(normalizeDateStr(now)) ?? maxFinNumber;
  const assignedNum = input.assignedAt ? inicioMap.get(normalizeDateStr(input.assignedAt)) : undefined;

  let diasGestion: number | null = null;
  if (assignedNum !== undefined && nowNum !== undefined) {
    const gestionRef = input.gestionAt ?? now;
    const gestionNum = finMap.get(normalizeDateStr(gestionRef)) ?? (input.gestionAt ? undefined : nowNum);
    if (gestionNum !== undefined) {
      diasGestion = (gestionNum - assignedNum) - input.diasDescuento;
    }
  }

  let fechaTentativaGestion: string | null = null;
  if (input.gestionAt) {
    fechaTentativaGestion = input.gestionAt.toISOString();
  } else if (assignedNum !== undefined && input.ansOportunidad != null) {
    const offset = input.ansOportunidad + (input.diasDescuento || 0);
    fechaTentativaGestion = finNumberToDate.get(assignedNum + offset) ?? null;
  }

  let diasPasados: number | null = null;
  let cumplimiento: "Cumple" | "No cumple" | null = null;
  if (assignedNum !== undefined && input.ansOportunidad != null && nowNum !== undefined) {
    const vencimientoNum = assignedNum + input.ansOportunidad + (input.diasDescuento || 0);
    const refNum = input.gestionAt
      ? finMap.get(normalizeDateStr(input.gestionAt))
      : nowNum;
    if (refNum !== undefined) {
      diasPasados = vencimientoNum - refNum;
      cumplimiento = diasPasados >= 0 ? "Cumple" : "No cumple";
    }
  }

  return { diasGestion, fechaTentativaGestion, diasPasados, cumplimiento };
}

function statusLabel(status: WorkOrderStatus) {
  const map: Record<WorkOrderStatus, string> = {
    DRAFT: "Borrador",
    CREATED: "Creada",
    ASSIGNED: "Asignada",
    IN_PROGRESS: "En ejecución",
    ON_HOLD: "En pausa",
    COMPLETED: "Completada",
    CANCELLED: "Cancelada",
    EXCLUDED: "Excluida",
    FACTURADA: "Facturada",
    GESTIONADA: "Gestionada",
    CERRADA: "Cerrada",
    ASIGNADA: "Asignada",
    EN_EJECUCION: "En ejecución",
    DEVUELTA: "Devuelta"
  };
  return map[status] ?? status;
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

function diffByCalendar(inicioMap: Map<string, number>, finMap: Map<string, number>, start: Date | null, end: Date | null) {
  if (!start || !end) return null;
  const startNum = inicioMap.get(normalizeDateStr(start));
  const endNum = finMap.get(normalizeDateStr(end));
  if (startNum === undefined || endNum === undefined) return null;
  return Math.max(0, endNum - startNum);
}

function diffByCalendarEndNow(inicioMap: Map<string, number>, finMap: Map<string, number>, start: Date | null, end: Date | null, now: Date) {
  if (!start) return null;
  return diffByCalendar(inicioMap, finMap, start, end ?? now);
}

function colorByThreshold(value: number | null, threshold: number): "green" | "yellow" | "red" | null {
  if (value === null) return null;
  if (value > threshold) return "red";
  const warnWindow = 2;
  return value > threshold - warnWindow ? "yellow" : "green";
}

exportsRouter.get("/general.csv", requireAuth, requirePermission("EXPORTES"), async (req, res) => {
  const parsed = dateRangeSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_QUERY" });
    return;
  }

  const { dateStart, dateEnd } = parsed.data;
  const start = dateStart ? toDateStart(dateStart) : null;
  const end = dateEnd ? toDateEnd(dateEnd) : null;

  const where = {
    ...(start || end
      ? {
          assignedAt: {
            ...(start ? { gte: start } : {}),
            ...(end ? { lte: end } : {})
          }
        }
      : {})
  };

  const [calendar, orders] = await Promise.all([
    prisma.calendar.findMany({ select: { date: true, dayNumber: true, dayNumberFin: true } }),
    prisma.workOrder.findMany({
      where,
      orderBy: { assignedAt: "asc" },
      select: {
        code: true,
        status: true,
        gestorCc: true,
        gestorNombre: true,
        tipoIncremento: true,
        oportunidad: true,
        ansOportunidad: true,
        assignedAt: true,
        gestionAt: true,
        diasDescuento: true
      }
    })
  ]);

  const { inicioMap, finMap, finNumberToDate, maxFinNumber } = buildCalendarMaps(calendar);

  const headers = [
    "OT",
    "Estado",
    "Gestor",
    "Gestor CC",
    "Tipo Incremento",
    "Oportunidad",
    "ANS",
    "Fecha Asignación",
    "Fecha Gestión",
    "Fecha tentativa/Gestión",
    "D. Descuento",
    "Días Gestión",
    "D. Pasados",
    "Cumple"
  ];

  const rows = orders.map((o) => {
    const derived = computeDerived(
      {
        assignedAt: o.assignedAt,
        gestionAt: o.gestionAt,
        ansOportunidad: o.ansOportunidad,
        diasDescuento: o.diasDescuento
      },
      inicioMap,
      finMap,
      finNumberToDate,
      maxFinNumber
    );

    return [
      o.code,
      statusLabel(o.status),
      o.gestorNombre ?? "",
      o.gestorCc ?? "",
      o.tipoIncremento ?? "",
      o.oportunidad ?? "",
      o.ansOportunidad ?? "",
      o.assignedAt?.toISOString() ?? "",
      o.gestionAt?.toISOString() ?? "",
      derived.fechaTentativaGestion ?? "",
      o.diasDescuento,
      derived.diasGestion ?? "",
      derived.diasPasados ?? "",
      derived.cumplimiento ?? ""
    ];
  });

  const csv = toCsv(headers, rows);
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="reporte_general.csv"`);
  res.send(csv);
});

exportsRouter.get("/orders.csv", requireAuth, requirePermission("EXPORTES"), async (req, res) => {
  const querySchema = z.object({
    status: z.union([statusSchema, z.array(statusSchema)]).optional(),
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

  const { status, search, gestor, oportunidad, dateField, dateStart, dateEnd, colorFilter } = parsed.data;
  const start = dateStart ? toDateStart(dateStart) : null;
  const end = dateEnd ? toDateEnd(dateEnd) : null;

  const where: Prisma.WorkOrderWhereInput = {
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
      : {})
  };

  if (status) {
    const statusArray = Array.isArray(status) ? status : [status];
    const conditions: Prisma.WorkOrderWhereInput[] = [{ status: { in: statusArray as unknown as WorkOrderStatus[] } }];
    if (statusArray.includes("DEVUELTA")) conditions.push({ estadoSecundario: "DEVUELTA" });
    where.OR = conditions;
  }

  if (dateField && (start || end)) {
    const range = {
      ...(start ? { gte: start } : {}),
      ...(end ? { lte: end } : {})
    };
    if (dateField === "assignedAt") where.assignedAt = range;
    if (dateField === "gestionAt") where.gestionAt = range;
  }

  const [calendar, orders] = await Promise.all([
    prisma.calendar.findMany({ select: { date: true, dayNumber: true, dayNumberFin: true } }),
    prisma.workOrder.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      select: {
        code: true,
        status: true,
        gestorCc: true,
        gestorNombre: true,
        tipoIncremento: true,
        oportunidad: true,
        ansOportunidad: true,
        assignedAt: true,
        gestionAt: true,
        diasDescuento: true
      }
    })
  ]);

  const { inicioMap, finMap, finNumberToDate, maxFinNumber } = buildCalendarMaps(calendar);

  const codes = orders.map((o) => o.code);
  const [baremos, enelGroups, novedades, devoluciones] = await Promise.all([
    prisma.actividadBaremo.findMany({
      where: { codigo: { in: codes } },
      select: { codigo: true, totalBarSum: true, ansRef: true, ansCalc: true }
    }),
    prisma.recorridoIncremento.groupBy({
      by: ["orderCode", "nombreIncremento"],
      where: { orderCode: { in: codes }, responsable: "ENEL", diasEnel: { not: null } },
      _sum: { diasEnel: true },
      _count: { diasEnel: true }
    }),
    prisma.novedad.findMany({
      where: { workOrder: { code: { in: codes } }, fechaFin: { not: null } },
      select: { workOrder: { select: { code: true } }, fechaInicio: true, fechaFin: true }
    }),
    prisma.workOrderHistory.findMany({
      where: {
        workOrder: { code: { in: codes } },
        note: { contains: "Descuento por devolución" },
        fechaInicio: { not: null },
        fechaFin: { not: null }
      },
      select: { workOrder: { select: { code: true } }, fechaInicio: true, fechaFin: true }
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

  const novedadSumMap = new Map<string, number>();
  for (const n of novedades) {
    const iniNum = inicioMap.get(normalizeDateStr(new Date(n.fechaInicio)));
    const finNum = n.fechaFin ? finMap.get(normalizeDateStr(new Date(n.fechaFin))) : undefined;
    if (iniNum !== undefined && finNum !== undefined) {
      const diff = finNum - iniNum;
      if (diff > 0) {
        novedadSumMap.set(n.workOrder.code, (novedadSumMap.get(n.workOrder.code) ?? 0) + diff);
      }
    }
  }

  const devolucionSumMap = new Map<string, number>();
  for (const d of devoluciones) {
    const iniNum = d.fechaInicio ? inicioMap.get(normalizeDateStr(new Date(d.fechaInicio))) : undefined;
    const finNum = d.fechaFin ? finMap.get(normalizeDateStr(new Date(d.fechaFin))) : undefined;
    if (iniNum !== undefined && finNum !== undefined) {
      const diff = finNum - iniNum;
      if (diff > 0) {
        devolucionSumMap.set(d.workOrder.code, (devolucionSumMap.get(d.workOrder.code) ?? 0) + diff);
      }
    }
  }

  const headers = [
    "OT",
    "Estado",
    "Gestor",
    "Gestor CC",
    "Tipo Incremento",
    "Oportunidad",
    "ANS",
    "Fecha Asignación",
    "Fecha Gestión",
    "Fecha tentativa/Gestión",
    "Baremo",
    "R. Incrementos",
    "D. Devoluciones",
    "D. Novedades",
    "D. Descuento Total",
    "Días Gestión",
    "D. Pasados",
    "Cumple"
  ];

  const rows = orders
    .map((o): (string | number)[] | null => {
      const derived = computeDerived(
        {
          assignedAt: o.assignedAt,
          gestionAt: o.gestionAt,
          ansOportunidad: o.ansOportunidad,
          diasDescuento: o.diasDescuento
        },
        inicioMap,
        finMap,
        finNumberToDate,
        maxFinNumber
      );

      const baremo = baremoMap.get(o.code);
      const baremoInt = typeof baremo?.ansCalc === "number" ? Math.round(baremo.ansCalc) : 0;
      const diasEnel = enelSumMap.get(o.code) ?? 0;
      const diasNovedades = novedadSumMap.get(o.code) ?? 0;
      const diasDevoluciones = devolucionSumMap.get(o.code) ?? 0;
      const extraDescuento = baremoInt + diasEnel;

      const totalDiasDescuento = o.diasDescuento + extraDescuento;
      const diasGestion = derived.diasGestion == null ? null : Math.max(0, derived.diasGestion - extraDescuento);
      const diasPasados = derived.diasPasados == null ? null : derived.diasPasados + extraDescuento;

      const assignedNum = o.assignedAt ? inicioMap.get(normalizeDateStr(o.assignedAt)) : undefined;
      const fechaTentativaGestion =
        o.gestionAt
          ? o.gestionAt.toISOString()
          : assignedNum !== undefined && o.ansOportunidad != null
            ? finNumberToDate.get(assignedNum + o.ansOportunidad + totalDiasDescuento) ?? derived.fechaTentativaGestion
            : derived.fechaTentativaGestion;

      const cumplimiento =
        o.status === "EXCLUDED"
          ? "Cumple"
          : diasPasados == null
            ? derived.cumplimiento
            : diasPasados >= 0
              ? "Cumple"
              : "No cumple";

      if (colorFilter) {
        const isRed = cumplimiento === "No cumple";
        if (colorFilter === "red" && !isRed) return null;
        if (colorFilter === "green" && isRed) return null;
      }

      return [
        o.code,
        statusLabel(o.status),
        o.gestorNombre ?? "",
        o.gestorCc ?? "",
        o.tipoIncremento ?? "",
        o.oportunidad ?? "",
        o.ansOportunidad ?? "",
        o.assignedAt?.toISOString() ?? "",
        o.gestionAt?.toISOString() ?? "",
        fechaTentativaGestion ?? "",
        baremoInt,
        diasEnel,
        diasDevoluciones,
        diasNovedades,
        totalDiasDescuento,
        diasGestion ?? "",
        diasPasados ?? "",
        cumplimiento ?? ""
      ];
    })
    .filter((r): r is (string | number)[] => r !== null);

  const csv = toCsv(headers, rows);
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="ordenes.csv"`);
  res.send(csv);
});

exportsRouter.get("/levantamientos.csv", requireAuth, requirePermission("EXPORTES"), async (req, res) => {
  const querySchema = z.object({
    search: z.string().min(1).optional(),
    nivelTension: z.string().min(1).optional(),
    cuadrilla: z.string().min(1).optional(),
    etapa: z.enum(["ASIGNACION", "PRIMER_ELEMENTO", "ENTREGA_POSTPROCESO", "APROBACION_POSTPROCESO", "GESTION"]).optional(),
    asignacionStart: z.string().min(1).optional(),
    asignacionEnd: z.string().min(1).optional(),
    dateStart: z.string().optional(),
    dateEnd: z.string().optional(),
    diasAsignaColor: z.enum(["red", "yellow", "green"]).optional(),
    diasAprobacionPostColor: z.enum(["red", "yellow", "green"]).optional(),
    diasCierreColor: z.enum(["red", "yellow", "green"]).optional(),
    diasGestionTotalColor: z.enum(["red", "yellow", "green"]).optional()
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
    dateStart,
    dateEnd,
    diasAsignaColor,
    diasAprobacionPostColor,
    diasCierreColor,
    diasGestionTotalColor
  } = parsed.data;

  const parseDay = (value: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) return null;
    const d = parseBogotaDateOnly(value.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const startRaw = asignacionStart ?? dateStart;
  const endRaw = asignacionEnd ?? dateEnd;
  const startDate = startRaw ? parseDay(startRaw) : null;
  const endDate = endRaw ? parseDay(endRaw) : null;
  if ((startRaw && !startDate) || (endRaw && !endDate)) {
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
      orderBy: { fechaPrimerElemento: "desc" },
      select: {
        orderCode: true,
        nivelTension: true,
        estado: true,
        subestado: true,
        cuadrilla: true,
        fechaAprobacionValorizacionSt: true,
        fechaAsignacion: true,
        fechaPrimerElemento: true,
        fechaEntregaPostproceso: true,
        fechaAprobacionPostproceso: true,
        fechaGestion: true
      }
    }),
    prisma.calendar.findMany({ select: { date: true, dayNumber: true, dayNumberFin: true } })
  ]);

  const inicioMap = new Map<string, number>();
  const finMap = new Map<string, number>();
  const finNumberToDate = new Map<number, string>();
  for (const c of calendar) {
    const key = normalizeDateStr(c.date);
    inicioMap.set(key, c.dayNumber);
    const finNum = c.dayNumberFin ?? c.dayNumber;
    finMap.set(key, finNum);
    finNumberToDate.set(finNum, key);
  }

  const codes = rows.map((r) => r.orderCode);
  const [wo, novedades] = await Promise.all([
    codes.length ? prisma.workOrder.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } }) : [],
    codes.length
      ? prisma.novedad.findMany({
          where: { workOrder: { code: { in: codes } }, fechaFin: { not: null } },
          select: { workOrder: { select: { code: true } }, fechaInicio: true, fechaFin: true }
        })
      : []
  ]);

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

  const novedadSumByCode = new Map<string, number>();
  for (const n of novedades) {
    const iniNum = inicioMap.get(normalizeDateStr(n.fechaInicio));
    const finNum = n.fechaFin ? finMap.get(normalizeDateStr(n.fechaFin)) : undefined;
    if (iniNum !== undefined && finNum !== undefined) {
      const diff = finNum - iniNum;
      if (diff >= 0) novedadSumByCode.set(n.workOrder.code, (novedadSumByCode.get(n.workOrder.code) ?? 0) + (diff + 1));
    }
  }

  const THRESHOLD_DIAS_ASIGNA = 4;
  const THRESHOLD_DIAS_APROBACION_POST = 3;
  const THRESHOLD_DIAS_CIERRE = 8;
  const now = new Date();

  const headers = [
    "Orden Trabajo",
    "Nivel de Tensión",
    "Estado",
    "Subestado",
    "Cuadrilla",
    "Fecha Primer Elemento",
    "Fecha Entrega Postproceso",
    "Fecha Aprobación Postproceso",
    "Fecha Gestión",
    "Fecha Gestión Calculada",
    "Días Asigna",
    "Días aprobación Post",
    "Días cierre",
    "Días novedades",
    "Días gestión total",
    "Etapa"
  ];

  const items = rows
    .map((r) => {
      const baseNum = r.fechaPrimerElemento ? inicioMap.get(normalizeDateStr(r.fechaPrimerElemento)) : undefined;
      const diasNovedades = novedadSumByCode.get(r.orderCode) ?? 0;
      const vencimientoNum = baseNum !== undefined ? baseNum + 8 + diasNovedades : undefined;
      const fechaGestionCalculada =
        !r.fechaGestion && vencimientoNum !== undefined
          ? (() => {
              const targetKey = finNumberToDate.get(vencimientoNum) ?? null;
              return targetKey ? parseBogotaDateOnly(targetKey) : null;
            })()
          : null;
      const fechaGestionEfectiva = r.fechaGestion ?? fechaGestionCalculada;

      const applyNovedades = (v: number | null) => (v === null ? null : Math.max(0, v - diasNovedades));

      const diasAsignaRaw = diffByCalendarEndNow(
        inicioMap,
        finMap,
        r.fechaAprobacionValorizacionSt ?? null,
        r.fechaAsignacion,
        now
      );
      const diasAsigna = applyNovedades(diasAsignaRaw);

      const entregaPost = r.fechaEntregaPostproceso ?? cierreSaitByCode.get(r.orderCode) ?? null;
      const aprobEndNum = finMap.get(normalizeDateStr(r.fechaAprobacionPostproceso ?? now));
      const diasAprobacionPostRaw =
        entregaPost
          ? diffByCalendarEndNow(inicioMap, finMap, entregaPost, r.fechaAprobacionPostproceso, now)
          : baseNum !== undefined && aprobEndNum !== undefined
            ? Math.max(0, aprobEndNum - (baseNum + 3))
            : null;
      const diasAprobacionPost = applyNovedades(diasAprobacionPostRaw);

      const cierreStartNum = r.fechaAprobacionPostproceso ? inicioMap.get(normalizeDateStr(r.fechaAprobacionPostproceso)) : undefined;
      const cierreEndNum = r.fechaGestion ? finMap.get(normalizeDateStr(r.fechaGestion)) : baseNum !== undefined ? baseNum + 8 : undefined;
      const diasCierreRaw = cierreStartNum !== undefined && cierreEndNum !== undefined ? Math.max(0, cierreEndNum - cierreStartNum) : null;
      const diasCierre = applyNovedades(diasCierreRaw);

      const refDate = r.fechaGestion ?? now;
      const refNum = finMap.get(normalizeDateStr(refDate));
      const diasGestionTotal = vencimientoNum !== undefined && refNum !== undefined ? vencimientoNum - refNum : null;

      const diasAsignaColorCalc = colorByThreshold(diasAsigna, THRESHOLD_DIAS_ASIGNA);
      const diasAprobacionPostColorCalc = colorByThreshold(diasAprobacionPost, THRESHOLD_DIAS_APROBACION_POST);
      const diasCierreColorCalc = colorByThreshold(diasCierre, THRESHOLD_DIAS_CIERRE);
      const diasGestionTotalColorCalc =
        diasGestionTotal === null ? null : diasGestionTotal < 0 ? "red" : diasGestionTotal <= 2 ? "yellow" : "green";

      const etapaCalc =
        r.fechaGestion
          ? "GESTION"
          : r.fechaAprobacionPostproceso
            ? "APROBACION_POSTPROCESO"
            : entregaPost
              ? "ENTREGA_POSTPROCESO"
              : r.fechaPrimerElemento
                ? "PRIMER_ELEMENTO"
                : r.fechaAsignacion
                  ? "ASIGNACION"
                  : "SIN";

      if (etapa && etapaCalc !== etapa) return null;
      if (diasAsignaColor && diasAsignaColorCalc !== diasAsignaColor) return null;
      if (diasAprobacionPostColor && diasAprobacionPostColorCalc !== diasAprobacionPostColor) return null;
      if (diasCierreColor && diasCierreColorCalc !== diasCierreColor) return null;
      if (diasGestionTotalColor && diasGestionTotalColorCalc !== diasGestionTotalColor) return null;

      return [
        r.orderCode,
        r.nivelTension ?? "",
        r.estado ?? "",
        r.subestado ?? "",
        r.cuadrilla ?? "",
        r.fechaPrimerElemento?.toISOString() ?? "",
        entregaPost?.toISOString() ?? "",
        r.fechaAprobacionPostproceso?.toISOString() ?? "",
        fechaGestionEfectiva?.toISOString() ?? "",
        fechaGestionCalculada?.toISOString() ?? "",
        diasAsigna ?? "",
        diasAprobacionPost ?? "",
        diasCierre ?? "",
        diasNovedades,
        diasGestionTotal ?? "",
        etapaCalc
      ];
    })
    .filter((x): x is (string | number)[] => x !== null);

  const csv = toCsv(headers, items);
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="levantamientos.csv"`);
  res.send(csv);
});

exportsRouter.get("/devoluciones.csv", requireAuth, requirePermission("EXPORTES"), async (req, res) => {
  const parsed = dateRangeSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_QUERY" });
    return;
  }

  const { dateStart, dateEnd } = parsed.data;
  const start = dateStart ? toDateStart(dateStart) : null;
  const end = dateEnd ? toDateEnd(dateEnd) : null;

  const calendar = await prisma.calendar.findMany({ select: { date: true, dayNumber: true, dayNumberFin: true } });
  const { inicioMap, finMap } = buildCalendarMaps(calendar);

  const histories = await prisma.workOrderHistory.findMany({
    where: {
      note: { contains: "Descuento por devolución" },
      workOrder: {
        ...(start || end
          ? {
              assignedAt: {
                ...(start ? { gte: start } : {}),
                ...(end ? { lte: end } : {})
              }
            }
          : {})
      }
    },
    orderBy: { changedAt: "asc" },
    select: {
      changedAt: true,
      workOrder: { select: { code: true, assignedAt: true, gestorNombre: true } },
      fechaInicio: true,
      fechaFin: true,
      note: true
    }
  });

  const headers = ["OT", "Gestor", "Fecha Asignación", "Fecha Devolución", "Fecha Respuesta", "Días Descuento", "Nota", "Registrado"];
  const rows = histories.map((h) => {
    const iniNum = h.fechaInicio ? inicioMap.get(normalizeDateStr(new Date(h.fechaInicio))) : undefined;
    const finNum = h.fechaFin ? finMap.get(normalizeDateStr(new Date(h.fechaFin))) : undefined;
    const diff = iniNum !== undefined && finNum !== undefined ? finNum - iniNum : "";
    return [
      h.workOrder.code,
      h.workOrder.gestorNombre ?? "",
      h.workOrder.assignedAt?.toISOString() ?? "",
      h.fechaInicio ?? "",
      h.fechaFin ?? "",
      diff,
      h.note ?? "",
      h.changedAt.toISOString()
    ];
  });

  const csv = toCsv(headers, rows);
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="reporte_devoluciones.csv"`);
  res.send(csv);
});

exportsRouter.get("/historial.csv", requireAuth, requirePermission("EXPORTES"), async (req, res) => {
  const parsed = dateRangeSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_QUERY" });
    return;
  }

  const { dateStart, dateEnd } = parsed.data;
  const start = dateStart ? toDateStart(dateStart) : null;
  const end = dateEnd ? toDateEnd(dateEnd) : null;

  const calendar = await prisma.calendar.findMany({ select: { date: true, dayNumber: true, dayNumberFin: true } });
  const { inicioMap, finMap } = buildCalendarMaps(calendar);

  const histories = await prisma.workOrderHistory.findMany({
    where: {
      workOrder: {
        ...(start || end
          ? {
              assignedAt: {
                ...(start ? { gte: start } : {}),
                ...(end ? { lte: end } : {})
              }
            }
          : {})
      }
    },
    orderBy: [{ workOrderId: "asc" }, { changedAt: "asc" }],
    select: {
      changedAt: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      noteDetail: true,
      fechaInicio: true,
      fechaFin: true,
      workOrder: { select: { code: true, assignedAt: true } }
    }
  });

  const headers = [
    "OT",
    "Fecha Asignación",
    "Cambiado",
    "Desde",
    "Hacia",
    "Nota",
    "Detalle",
    "Fecha Inicio",
    "Fecha Fin",
    "Días"
  ];

  const rows = histories.map((h) => {
    const iniNum = h.fechaInicio ? inicioMap.get(normalizeDateStr(new Date(h.fechaInicio))) : undefined;
    const finNum = h.fechaFin ? finMap.get(normalizeDateStr(new Date(h.fechaFin))) : undefined;
    const diff = iniNum !== undefined && finNum !== undefined ? finNum - iniNum : "";

    return [
      h.workOrder.code,
      h.workOrder.assignedAt?.toISOString() ?? "",
      h.changedAt.toISOString(),
      h.fromStatus ?? "",
      h.toStatus,
      h.note ?? "",
      h.noteDetail ?? "",
      h.fechaInicio ?? "",
      h.fechaFin ?? "",
      diff
    ];
  });

  const csv = toCsv(headers, rows);
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="reporte_historial.csv"`);
  res.send(csv);
});
