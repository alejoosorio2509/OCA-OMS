import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../auth.js";

export const solCdsNuevosRouter = Router();

const bogotaDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

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

async function loadCalendarMaps() {
  const calendar = await prisma.calendar.findMany({
    select: { date: true, dayNumber: true, dayNumberFin: true }
  });

  const inicioMap = new Map<string, number>();
  const finMap = new Map<string, number>();

  for (const c of calendar) {
    const key = c.date.toISOString().slice(0, 10);
    inicioMap.set(key, c.dayNumber);
    finMap.set(key, c.dayNumberFin ?? c.dayNumber);
  }

  return { inicioMap, finMap };
}

function diffDiasCalendario(inicio: Date, fin: Date, inicioMap: Map<string, number>, finMap: Map<string, number>) {
  const inicioNum = inicioMap.get(normalizeDay(inicio));
  const finNum = finMap.get(normalizeDay(fin));
  if (inicioNum !== undefined && finNum !== undefined) {
    return finNum - inicioNum;
  }
  const ms = parseBogotaDateOnly(normalizeDay(fin)).getTime() - parseBogotaDateOnly(normalizeDay(inicio)).getTime();
  return Math.round(ms / 86400000);
}

function cleanText(value: string) {
  return value.trim();
}

function stringEqInsensitive(value: string) {
  return { equals: value, mode: "insensitive" as const };
}

solCdsNuevosRouter.get("/options", requireAuth, requirePermission("SOL_CDS_NUEVOS"), async (_req, res) => {
  const [subRows, marcaRows, modeloRows, utRows] = await Promise.all([
    prisma.circuitoSubestacion.findMany({
      select: { codCircuito: true, nomCircuito: true, nomSubestacion: true }
    }),
    prisma.modeloCategoriaMb.findMany({
      select: { denominacionFabricante: true }
    }),
    prisma.modeloCategoriaMb.findMany({
      select: { descripcionTipo: true }
    }),
    prisma.unidadTerritorial.findMany({
      select: { terDesc: true, orgDesc: true }
    })
  ]);

  const uniq = (values: Array<string | null | undefined>) =>
    Array.from(
      new Set(
        values
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter((v) => v.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b));

  const subestaciones = uniq(subRows.map((r) => r.nomSubestacion));
  const codCircuitStm = uniq(subRows.map((r) => r.nomCircuito));
  const circuitoStm = uniq(subRows.map((r) => r.codCircuito));
  const marcas = uniq(marcaRows.map((r) => r.denominacionFabricante));
  const modelos = uniq(modeloRows.map((r) => r.descripcionTipo));

  const terDesc = uniq(utRows.map((r) => r.orgDesc));
  const orgDesc = uniq(utRows.map((r) => r.terDesc));

  res.json({
    tipoOrden: ["Inconsistencia", "Incrementos Ex Post", "Incremento por PDL/PST", "VCR"],
    subestaciones,
    codCircuitStm,
    circuitoStm,
    marcas,
    modelos,
    terDesc,
    orgDesc
  });
});

solCdsNuevosRouter.post("/", requireAuth, requirePermission("SOL_CDS_NUEVOS"), async (req, res) => {
  const bodySchema = z.object({
    ot: z.string().min(1),
    incremento: z.string().min(1),
    tipoOrden: z.enum(["Inconsistencia", "Incrementos Ex Post", "Incremento por PDL/PST", "VCR"]),
    cd: z.string().min(1),
    subestacionSbItm: z.string().min(1),
    codCircuitStm: z.string().min(1),
    circuitoStm: z.string().min(1),
    marca: z.string().min(1),
    modelo: z.string().min(1),
    punFisico: z.string().min(1),
    direccion: z.string().min(1),
    terDesc: z.string().min(1),
    orgDesc: z.string().min(1),
    usoTrafo: z.enum(["ENEL", "CLIENTE"]),
    propiedad: z.enum(["ENEL", "CLIENTE"]),
    tipRedTransformador: z.enum(["Subterranea", "Aerea"]),
    fase: z.enum(["Trifasico", "Bifasico", "Monofasico"]),
    coordenadasX: z.string().min(1),
    coordenadasY: z.string().min(1)
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY", details: parsed.error.issues });
    return;
  }

  const data = {
    ...parsed.data,
    ot: cleanText(parsed.data.ot),
    incremento: cleanText(parsed.data.incremento),
    cd: cleanText(parsed.data.cd),
    subestacionSbItm: cleanText(parsed.data.subestacionSbItm),
    codCircuitStm: cleanText(parsed.data.codCircuitStm),
    circuitoStm: cleanText(parsed.data.circuitoStm),
    marca: cleanText(parsed.data.marca),
    modelo: cleanText(parsed.data.modelo),
    punFisico: cleanText(parsed.data.punFisico),
    direccion: cleanText(parsed.data.direccion),
    terDesc: cleanText(parsed.data.terDesc),
    orgDesc: cleanText(parsed.data.orgDesc),
    coordenadasX: cleanText(parsed.data.coordenadasX),
    coordenadasY: cleanText(parsed.data.coordenadasY)
  };

  const [subOk, codOk, circuitoOk, marcaOk, modeloOk, terOk, orgOk] = await Promise.all([
    prisma.circuitoSubestacion.findFirst({
      where: { nomSubestacion: stringEqInsensitive(data.subestacionSbItm) },
      select: { codCircuito: true }
    }),
    prisma.circuitoSubestacion.findFirst({
      where: { nomCircuito: stringEqInsensitive(data.codCircuitStm) },
      select: { codCircuito: true }
    }),
    prisma.circuitoSubestacion.findFirst({
      where: { codCircuito: stringEqInsensitive(data.circuitoStm) },
      select: { codCircuito: true }
    }),
    prisma.modeloCategoriaMb.findFirst({
      where: { denominacionFabricante: stringEqInsensitive(data.marca) },
      select: { id: true }
    }),
    prisma.modeloCategoriaMb.findFirst({
      where: { descripcionTipo: stringEqInsensitive(data.modelo) },
      select: { id: true }
    }),
    prisma.unidadTerritorial.findFirst({
      where: { orgDesc: stringEqInsensitive(data.terDesc) },
      select: { id: true }
    }),
    prisma.unidadTerritorial.findFirst({
      where: { terDesc: stringEqInsensitive(data.orgDesc) },
      select: { id: true }
    })
  ]);

  const details: Array<{ path: string[]; message: string; code: string }> = [];
  if (!subOk) details.push({ path: ["subestacionSbItm"], message: "VALOR_NO_EN_CATALOGO", code: "custom" });
  if (!codOk) details.push({ path: ["codCircuitStm"], message: "VALOR_NO_EN_CATALOGO", code: "custom" });
  if (!circuitoOk) details.push({ path: ["circuitoStm"], message: "VALOR_NO_EN_CATALOGO", code: "custom" });
  if (!marcaOk) details.push({ path: ["marca"], message: "VALOR_NO_EN_CATALOGO", code: "custom" });
  if (!modeloOk) details.push({ path: ["modelo"], message: "VALOR_NO_EN_CATALOGO", code: "custom" });
  if (!terOk) details.push({ path: ["terDesc"], message: "VALOR_NO_EN_CATALOGO", code: "custom" });
  if (!orgOk) details.push({ path: ["orgDesc"], message: "VALOR_NO_EN_CATALOGO", code: "custom" });
  if (details.length) {
    res.status(400).json({ error: "INVALID_BODY", details });
    return;
  }

  const nextRows = (await prisma.$queryRaw`SELECT nextval('"SolCdsNuevo_id_seq"') as id`) as Array<{ id: bigint | number }>;
  const nextIdRaw = nextRows[0]?.id;
  const nextId = typeof nextIdRaw === "bigint" ? Number(nextIdRaw) : Number(nextIdRaw);
  if (!Number.isFinite(nextId) || nextId <= 0) {
    res.status(500).json({ error: "ID_SEQUENCE_ERROR" });
    return;
  }

  const registro = `CDN${String(nextId).padStart(6, "0")}`;

  const created = await prisma.solCdsNuevo.create({
    data: {
      id: nextId,
      registro,
      ...data,
      createdById: req.auth!.sub
    },
    select: {
      id: true,
      registro: true,
      createdAt: true
    }
  });

  res.status(201).json(created);
});

solCdsNuevosRouter.get("/", requireAuth, requirePermission("SOL_CDS_NUEVOS"), async (req, res) => {
  const all = req.auth?.role === "ADMIN" && (req.query.all === "1" || req.query.all === "true");
  const rows = await prisma.solCdsNuevo.findMany({
    where: all ? {} : { createdById: req.auth!.sub },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      registro: true,
      ot: true,
      incremento: true,
      tipoOrden: true,
      cd: true,
      subestacionSbItm: true,
      codCircuitStm: true,
      circuitoStm: true,
      marca: true,
      modelo: true,
      punFisico: true,
      direccion: true,
      terDesc: true,
      orgDesc: true,
      usoTrafo: true,
      propiedad: true,
      tipRedTransformador: true,
      fase: true,
      coordenadasX: true,
      coordenadasY: true,
      fechaFinNovedad: true,
      diasDescontados: true,
      createdAt: true,
      createdById: true,
      createdBy: { select: { name: true, email: true } }
    }
  });
  res.json(rows);
});

solCdsNuevosRouter.patch("/:id/fecha-fin-novedad", requireAuth, requirePermission("SOL_CDS_NUEVOS"), async (req, res) => {
  try {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const { fechaFin } = z.object({ fechaFin: z.string().min(1) }).parse(req.body);

    const solicitud = await prisma.solCdsNuevo.findUnique({ where: { id } });
    if (!solicitud) {
      res.status(404).json({ error: "SOLICITUD_NOT_FOUND" });
      return;
    }

    const dFin = parseBogotaDateOnly(fechaFin);
    if (isNaN(dFin.getTime())) {
      res.status(400).json({ error: "INVALID_DATE" });
      return;
    }

    // Fecha inicio novedad = fecha de registro de la solicitud
    const fechaInicio = solicitud.createdAt;
    if (dFin.getTime() < parseBogotaDateOnly(normalizeDay(fechaInicio)).getTime()) {
      res.status(400).json({ error: "FECHA_FIN_MENOR_INICIO" });
      return;
    }

    const { inicioMap, finMap } = await loadCalendarMaps();
    const dias = diffDiasCalendario(fechaInicio, dFin, inicioMap, finMap);
    const delta = dias - solicitud.diasDescontados;

    const order = await prisma.workOrder.findUnique({ where: { code: solicitud.ot } });
    if (order && delta !== 0) {
      await prisma.workOrder.update({
        where: { id: order.id },
        data: { diasDescuento: { increment: delta } }
      });
    }

    const updated = await prisma.solCdsNuevo.update({
      where: { id },
      data: { fechaFinNovedad: dFin, diasDescontados: dias },
      select: { id: true, fechaFinNovedad: true, diasDescontados: true }
    });

    if (order) {
      const user = await prisma.user.findUnique({
        where: { id: req.auth!.sub },
        select: { name: true, email: true }
      });
      await prisma.workOrderHistory.create({
        data: {
          workOrderId: order.id,
          toStatus: order.status,
          note: `Novedad ${solicitud.registro} - OT ${solicitud.ot}`,
          noteDetail: `Fecha inicio: ${normalizeDay(fechaInicio)} | Fecha fin: ${normalizeDay(dFin)} | Días descontados: ${dias} | Usuario: ${
            user?.name || user?.email || req.auth!.sub
          }`,
          fechaInicio: normalizeDay(fechaInicio),
          fechaFin: normalizeDay(dFin),
          changedById: req.auth!.sub
        }
      });
    }

    res.json({ ...updated, dias, orderFound: !!order });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "UNKNOWN";
    res.status(500).json({ error: "INTERNAL_ERROR", details: msg });
  }
});
