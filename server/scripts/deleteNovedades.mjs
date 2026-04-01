/* global process, console */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const code = process.argv[2];
if (!code) {
  console.error("Missing code argument");
  process.exit(1);
}

function normalizeDay(d) {
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return dd.toISOString();
}

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, email: true }
  });
  if (!admin) {
    console.error("NO_ADMIN_USER");
    process.exit(2);
  }

  const order = await prisma.workOrder.findUnique({
    where: { code },
    select: { id: true, code: true, status: true, diasDescuento: true }
  });
  if (!order) {
    console.error("ORDER_NOT_FOUND");
    process.exit(3);
  }

  const calendar = await prisma.calendar.findMany({ select: { date: true, dayNumber: true, dayNumberFin: true } });
  const inicioMap = new Map();
  const finMap = new Map();
  for (const c of calendar) {
    const iso = normalizeDay(new Date(c.date));
    inicioMap.set(iso, c.dayNumber);
    finMap.set(iso, c.dayNumberFin ?? c.dayNumber);
  }

  const novedades = await prisma.novedad.findMany({
    where: { workOrderId: order.id },
    select: { id: true, fechaInicio: true, fechaFin: true, descripcion: true, detalle: true }
  });

  let totalDias = 0;
  const historyDeleteFilters = [];

  for (const n of novedades) {
    const inicioNum = inicioMap.get(normalizeDay(n.fechaInicio));
    const finNum = n.fechaFin ? finMap.get(normalizeDay(n.fechaFin)) : undefined;
    if (inicioNum != null && finNum != null) {
      const diff = finNum - inicioNum;
      if (diff > 0) totalDias += diff;
    }

    const iniPrefix = normalizeDay(n.fechaInicio).slice(0, 10);
    const finPrefix = n.fechaFin ? normalizeDay(n.fechaFin).slice(0, 10) : null;
    historyDeleteFilters.push({
      note: n.descripcion,
      fechaInicio: { startsWith: iniPrefix },
      ...(finPrefix ? { fechaFin: { startsWith: finPrefix } } : { fechaFin: null })
    });
  }

  const nextDiasDescuento = Math.max(0, order.diasDescuento - totalDias);

  const lastNonHold = await prisma.workOrderHistory.findFirst({
    where: { workOrderId: order.id, toStatus: { not: "ON_HOLD" } },
    orderBy: { changedAt: "desc" },
    select: { toStatus: true }
  });
  const nextStatus = order.status === "ON_HOLD" ? (lastNonHold?.toStatus ?? order.status) : order.status;

  await prisma.$transaction(async (tx) => {
    if (historyDeleteFilters.length > 0) {
      await tx.workOrderHistory.deleteMany({
        where: {
          workOrderId: order.id,
          OR: historyDeleteFilters
        }
      });
    }

    await tx.novedad.deleteMany({ where: { workOrderId: order.id } });

    await tx.workOrder.update({
      where: { id: order.id },
      data: {
        diasDescuento: nextDiasDescuento,
        status: nextStatus,
        lastStatusChangeAt: nextStatus !== order.status ? new Date() : undefined
      }
    });

    await tx.workOrderHistory.create({
      data: {
        workOrderId: order.id,
        toStatus: nextStatus,
        note: "Eliminación de novedades",
        noteDetail: `NovedadesEliminadas=${novedades.length}; DiasNovedades=${totalDias}; DiasDescuentoAntes=${order.diasDescuento}; DiasDescuentoDespues=${nextDiasDescuento}`,
        changedById: admin.id
      }
    });
  });

  console.log(
    JSON.stringify(
      {
        code: order.code,
        admin: admin.email,
        deletedNovedades: novedades.length,
        diasNovedadesRemoved: totalDias,
        diasDescuento_before: order.diasDescuento,
        diasDescuento_after: nextDiasDescuento,
        status_before: order.status,
        status_after: nextStatus
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(10);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

