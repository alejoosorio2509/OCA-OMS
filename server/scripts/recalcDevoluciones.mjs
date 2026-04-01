/* global process, console */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const code = process.argv[2];
if (!code) {
  console.error("Missing code argument");
  process.exit(1);
}

function dayIso(d) {
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
    select: { id: true, code: true, status: true, assignedAt: true, diasDescuento: true }
  });
  if (!order) {
    console.error("NO_WORK_ORDER");
    process.exit(3);
  }

  const calendar = await prisma.calendar.findMany({ select: { date: true, dayNumber: true, dayNumberFin: true } });
  const inicioMap = new Map();
  const finMap = new Map();
  for (const c of calendar) {
    const iso = dayIso(new Date(c.date));
    inicioMap.set(iso, c.dayNumber);
    finMap.set(iso, c.dayNumberFin ?? c.dayNumber);
  }

  const histories = await prisma.workOrderHistory.findMany({
    where: { workOrderId: order.id, note: { contains: "Descuento por devolución" } },
    select: { id: true, fechaInicio: true, fechaFin: true }
  });

  const assignedDay = order.assignedAt ? dayIso(new Date(order.assignedAt)) : null;
  const assignedTs = assignedDay ? new Date(assignedDay).getTime() : null;

  let oldSum = 0;
  let newSum = 0;
  let omittedCount = 0;

  for (const h of histories) {
    if (!h.fechaInicio || !h.fechaFin) continue;
    const dev = new Date(h.fechaInicio);
    const fin = new Date(h.fechaFin);
    if (Number.isNaN(dev.getTime()) || Number.isNaN(fin.getTime())) continue;

    const devIso = dayIso(dev);
    const finIso = dayIso(fin);
    const inicio = inicioMap.get(devIso);
    const finNum = finMap.get(finIso);
    if (inicio == null || finNum == null) continue;

    const diff = finNum - inicio;
    if (diff <= 0) continue;

    oldSum += diff;

    if (assignedTs == null) {
      omittedCount += 1;
      continue;
    }
    const devTs = new Date(devIso).getTime();
    if (devTs <= assignedTs) {
      omittedCount += 1;
      continue;
    }
    newSum += diff;
  }

  const delta = newSum - oldSum;
  const nextDias = Math.max(0, order.diasDescuento + delta);

  await prisma.$transaction([
    prisma.workOrder.update({
      where: { id: order.id },
      data: { diasDescuento: nextDias }
    }),
    prisma.workOrderHistory.create({
      data: {
        workOrderId: order.id,
        toStatus: order.status,
        note: "Recalculo devoluciones",
        noteDetail: `DevolucionesAntes=${oldSum}; DevolucionesDespues=${newSum}; Ajuste=${delta}; Omitidas=${omittedCount}`,
        changedById: admin.id
      }
    })
  ]);

  console.log(
    JSON.stringify(
      {
        code: order.code,
        admin: admin.email,
        assignedAt: order.assignedAt,
        diasDescuento_before: order.diasDescuento,
        devoluciones_before: oldSum,
        devoluciones_after: newSum,
        delta,
        diasDescuento_after: nextDias,
        omittedCount
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
