/*
  Warnings:

  - You are about to drop the column `diasCumplimiento` on the `WorkOrder` table. All the data in the column will be lost.
  - You are about to drop the column `diasGestion` on the `WorkOrder` table. All the data in the column will be lost.
  - You are about to drop the column `oportunidad` on the `WorkOrder` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorkOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "criticality" TEXT NOT NULL DEFAULT 'MEDIUM',
    "estimatedMinutes" INTEGER,
    "dueAt" DATETIME,
    "gestorCc" TEXT,
    "gestorNombre" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "assignedAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "lastStatusChangeAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "assigneeId" TEXT,
    CONSTRAINT "WorkOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkOrder_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WorkOrder" ("assignedAt", "assigneeId", "cancelledAt", "code", "completedAt", "createdAt", "createdById", "criticality", "description", "dueAt", "estimatedMinutes", "gestorCc", "gestorNombre", "id", "lastStatusChangeAt", "startedAt", "status", "title", "updatedAt") SELECT "assignedAt", "assigneeId", "cancelledAt", "code", "completedAt", "createdAt", "createdById", "criticality", "description", "dueAt", "estimatedMinutes", "gestorCc", "gestorNombre", "id", "lastStatusChangeAt", "startedAt", "status", "title", "updatedAt" FROM "WorkOrder";
DROP TABLE "WorkOrder";
ALTER TABLE "new_WorkOrder" RENAME TO "WorkOrder";
CREATE UNIQUE INDEX "WorkOrder_code_key" ON "WorkOrder"("code");
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");
CREATE INDEX "WorkOrder_criticality_idx" ON "WorkOrder"("criticality");
CREATE INDEX "WorkOrder_dueAt_idx" ON "WorkOrder"("dueAt");
CREATE INDEX "WorkOrder_assigneeId_idx" ON "WorkOrder"("assigneeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
