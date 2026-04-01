import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.workOrder.count();
  console.log('Count:', count);
  const first = await prisma.workOrder.findFirst();
  console.log('First row:', JSON.stringify(first, null, 2));
  
  // If we had the raw data from cargues, it would be better.
  // But let's check what's in the DB fields we have.
}
main().catch(console.error).finally(() => prisma.$disconnect());
