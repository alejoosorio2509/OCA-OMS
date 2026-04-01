import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = "admin@local.test";
  const userEmail = "usuario@local.test";

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Administrador",
      role: "ADMIN",
      passwordHash: await bcrypt.hash("admin123", 10)
    }
  });

  const user = await prisma.user.upsert({
    where: { email: userEmail },
    update: {},
    create: {
      email: userEmail,
      name: "Usuario",
      role: "USER",
      passwordHash: await bcrypt.hash("usuario123", 10)
    }
  });

  const existing = await prisma.workOrder.count();
  if (existing === 0) {
    const now = new Date();
    const due = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const wo = await prisma.workOrder.create({
      data: {
        code: "OT-SEED",
        title: "Orden de ejemplo",
        description: "Esta es una orden inicial para probar el flujo.",
        status: "ASSIGNED",
        criticality: "HIGH",
        estimatedMinutes: 180,
        dueAt: due,
        createdById: admin.id,
        assigneeId: user.id,
        assignedAt: now,
        lastStatusChangeAt: now,
        history: {
          create: {
            fromStatus: null,
            toStatus: "ASSIGNED",
            changedById: admin.id
          }
        }
      }
    });

    const code = `OT-${wo.id.slice(-6).toUpperCase()}`;
    await prisma.workOrder.update({ where: { id: wo.id }, data: { code } });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
