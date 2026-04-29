import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../auth.js";

export const solCdsNuevosRouter = Router();

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
    tipoOrden: ["Inconsistencia", "Incrementos Ex Post", "Incremento por PDL/PST"],
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
    tipoOrden: z.enum(["Inconsistencia", "Incrementos Ex Post", "Incremento por PDL/PST"]),
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
      ...parsed.data,
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
      createdAt: true,
      createdById: true
    }
  });
  res.json(rows);
});
