-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorkOrderHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workOrderId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "note" TEXT DEFAULT '',
    "noteDetail" TEXT,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT NOT NULL,
    CONSTRAINT "WorkOrderHistory_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkOrderHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WorkOrderHistory" ("changedAt", "changedById", "fromStatus", "id", "note", "toStatus", "workOrderId") SELECT "changedAt", "changedById", "fromStatus", "id", "note", "toStatus", "workOrderId" FROM "WorkOrderHistory";
DROP TABLE "WorkOrderHistory";
ALTER TABLE "new_WorkOrderHistory" RENAME TO "WorkOrderHistory";
CREATE INDEX "WorkOrderHistory_workOrderId_idx" ON "WorkOrderHistory"("workOrderId");
CREATE INDEX "WorkOrderHistory_changedAt_idx" ON "WorkOrderHistory"("changedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
