import type { WorkOrderStatus } from "@prisma/client";

const transitions: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  DRAFT: ["CREATED", "CANCELLED"],
  CREATED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["IN_PROGRESS", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  EXCLUDED: [],
  FACTURADA: ["EXCLUDED"],
  GESTIONADA: ["EXCLUDED"],
  CERRADA: ["EXCLUDED"],
  ASIGNADA: ["EXCLUDED"],
  EN_EJECUCION: ["EXCLUDED"],
  DEVUELTA: ["EXCLUDED"]
};

export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus) {
  return transitions[from].includes(to);
}
