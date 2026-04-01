import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalizeIsoDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

async function main() {
  const calendar = await prisma.calendar.findMany({ select: { date: true, dayNumber: true } });
  const calendarMap = new Map<string, number>();
  for (const c of calendar) {
    const normalized = new Date(c.date.getFullYear(), c.date.getMonth(), c.date.getDate()).toISOString();
    calendarMap.set(normalized, c.dayNumber);
  }

  const histories = await prisma.workOrderHistory.findMany({
    where: {
      OR: [
        { note: { contains: "devolu" } },
        { note: { contains: "DEVUELTA" } }
      ]
    },
    select: { id: true, workOrderId: true, fechaInicio: true, fechaFin: true, note: true }
  });

  const decrementByOrderId = new Map<string, number>();
  let discountRows = 0;
  for (const h of histories) {
    if (!h.fechaInicio || !h.fechaFin) continue;
    if (!h.note?.toLowerCase().includes("descuento")) continue;

    const iniIso = normalizeIsoDate(h.fechaInicio);
    const finIso = normalizeIsoDate(h.fechaFin);
    if (!iniIso || !finIso) continue;
    const iniNum = calendarMap.get(iniIso);
    const finNum = calendarMap.get(finIso);
    if (iniNum === undefined || finNum === undefined) continue;
    const diff = finNum - iniNum;
    if (diff <= 0) continue;

    decrementByOrderId.set(h.workOrderId, (decrementByOrderId.get(h.workOrderId) ?? 0) + diff);
    discountRows++;
  }

  const orderIds = [...decrementByOrderId.keys()];
  const orders = orderIds.length
    ? await prisma.workOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, diasDescuento: true } })
    : [];

  const updates = orders.map((o) => {
    const dec = decrementByOrderId.get(o.id) ?? 0;
    const next = Math.max(0, o.diasDescuento - dec);
    return prisma.workOrder.update({ where: { id: o.id }, data: { diasDescuento: next } });
  });

  const deleteOp = prisma.workOrderHistory.deleteMany({
    where: {
      id: { in: histories.map((h) => h.id) }
    }
  });

  await prisma.$transaction([...updates, deleteOp]);

  const deletedCount = histories.length;
  const updatedOrders = orders.length;
  const totalDecrement = [...decrementByOrderId.values()].reduce((a, b) => a + b, 0);

  console.log(`Historial de devoluciones eliminado: ${deletedCount}`);
  console.log(`Órdenes ajustadas en diasDescuento: ${updatedOrders}`);
  console.log(`Total días de descuento restados (por devoluciones): ${totalDecrement}`);
  console.log(`Filas de descuento detectadas: ${discountRows}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
