import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  // Limpiar novedades
  const n = await prisma.novedad.deleteMany({});
  console.log(`Eliminadas ${n.count} novedades.`);
  
  // Limpiar historial que tenga noteDetail (que son las novedades)
  const h = await prisma.workOrderHistory.deleteMany({
    where: {
      OR: [
        { noteDetail: { not: null } },
        { noteDetail: { not: "" } }
      ]
    }
  });
  console.log(`Eliminados ${h.count} registros de historial de novedades.`);
  
  // Resetear días de descuento en las órdenes
  const o = await prisma.workOrder.updateMany({
    data: {
      diasDescuento: 0
    }
  });
  console.log(`Reseteados días de descuento en ${o.count} órdenes.`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
