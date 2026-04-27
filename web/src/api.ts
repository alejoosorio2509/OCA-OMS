import { API_URL } from "./apiUrl";

export type UserRole = "ADMIN" | "USER";

export type User = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  canOrders?: boolean;
  canCargues?: boolean;
  canExportes?: boolean;
  canUsers?: boolean;
};

export type WorkOrderStatus =
  | "DRAFT"
  | "CREATED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "COMPLETED"
  | "CANCELLED"
  | "EXCLUDED"
  | "FACTURADA"
  | "GESTIONADA"
  | "CERRADA"
  | "ASIGNADA"
  | "EN_EJECUCION"
  | "DEVUELTA";

export type WorkOrderCriticality = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type WorkOrderListItem = {
  id: string;
  code: string;
  title: string;
  description: string;
  status: WorkOrderStatus;
  criticality: WorkOrderCriticality;
  estimatedMinutes: number | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  lastStatusChangeAt: string;
  createdBy: User;
  assignee: User | null;
  overdue: boolean;
  compliant: boolean | null;
  diasGestion?: number | null;
  // Campos nuevos
  gestorCc?: string | null;
  gestorNombre?: string | null;
  tipoIncremento?: string | null;
  oportunidad?: string | null;
  ansOportunidad?: number | null;
  estadoSecundario?: string | null;
  gestionAt?: string | null;
  fechaTentativaGestion?: string | null;
  cumplimiento?: "Cumple" | "No cumple" | null;
  diasPasados?: number | null;
  totalDiasDescuento?: number | null;
  diasCumplimiento?: number | null;
  diasDevoluciones?: number | null;
  baremoTotal?: number | null;
  baremoAnsRef?: number | null;
  baremoAnsCalc?: number | null;
  diasEnel?: number | null;
};

export type WorkOrderDetails = WorkOrderListItem & {
  history: {
    id: string;
    fromStatus: WorkOrderStatus | null;
    toStatus: WorkOrderStatus;
    note: string;
    noteDetail: string | null;
    fechaInicio: string | null;
    fechaFin: string | null;
    diasNovedad: number | null;
    changedAt: string;
    changedBy: User;
  }[];
  novedades: {
    id: string;
    fechaInicio: string;
    fechaFin: string | null;
    descripcion: string;
    detalle: string;
    soportePath: string | null;
    createdAt: string;
  }[];
  levantamiento?: {
    id: string;
    orderCode: string;
    nivelTension: string | null;
    tipo: string | null;
    unidadSolicitante: string | null;
    proyecto: string | null;
    estado: string | null;
    subestado: string | null;
    subestacion: string | null;
    circuito: string | null;
    noCd: string | null;
    direccion: string | null;
    municipio: string | null;
    zona: string | null;
    alcance: string | null;
    fechaSolicitud: string | null;
    fechaAprobacionAlcanceSt: string | null;
    fechaEstimacionCostos: string | null;
    fechaAprobacionValorizacionSt: string | null;
    fechaPrevalidacion: string | null;
    fechaAsignacion: string | null;
    fechaPrimerElemento: string | null;
    fechaEntregaPostproceso: string | null;
    fechaAprobacionPostproceso: string | null;
    fechaGestion: string | null;
    fechaDevolucion: string | null;
    usuarioSolicitante: string | null;
    usuarioAsigna: string | null;
    gestor: string | null;
    observacionGestor: string | null;
    cuadrilla: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
};

export type LevantamientoListItem = {
  orderCode: string;
  nivelTension: string | null;
  estado: string | null;
  subestado: string | null;
  workOrderId: string | null;
  workOrderStatus: WorkOrderStatus | null;
  estadoSecundario: string | null;
  fechaAsignacion: string | null;
  fechaGestion: string | null;
  fechaGestionCalculada: string | null;
  diasAsigna: number | null;
  diasAprobacionPost: number | null;
  diasCierre: number | null;
  diasNovedades: number;
  diasGestionTotal: number | null;
  diasAsignaColor: "red" | "green" | null;
  diasAprobacionPostColor: "red" | "green" | null;
  diasCierreColor: "red" | "green" | null;
  diasGestionTotalColor: "red" | "green" | null;
};

async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = new Error("API_ERROR");
    (err as unknown as { status: number; data: unknown }).status = res.status;
    (err as unknown as { status: number; data: unknown }).data = data;
    throw err;
  }
  return data as T;
}

export async function login(email: string, password: string) {
  return apiFetch<{ token: string; user: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function me(token: string) {
  return apiFetch<User>("/auth/me", { token });
}

export async function listUsers(token: string) {
  return apiFetch<(User & { createdAt: string })[]>("/users", { token });
}

export async function createUser(
  token: string,
  input: {
    email: string;
    name: string;
    password: string;
    role?: UserRole;
    canOrders?: boolean;
    canCargues?: boolean;
    canExportes?: boolean;
    canUsers?: boolean;
  }
) {
  return apiFetch<User>("/users", { token, method: "POST", body: JSON.stringify(input) });
}

export async function updateUser(
  token: string,
  id: string,
  input: Partial<{
    email: string;
    name: string;
    role: UserRole;
    canOrders: boolean;
    canCargues: boolean;
    canExportes: boolean;
    canUsers: boolean;
  }>
) {
  return apiFetch<User>(`/users/${id}`, { token, method: "PATCH", body: JSON.stringify(input) });
}

export async function resetUserPassword(token: string, id: string, password?: string) {
  return apiFetch<{ id: string; password: string }>(`/users/${id}/reset-password`, {
    token,
    method: "POST",
    body: JSON.stringify(password ? { password } : {})
  });
}

export async function listWorkOrders(
  token: string,
  query: { 
    status?: WorkOrderStatus | WorkOrderStatus[]; 
    assigneeId?: string; 
    search?: string; 
    gestor?: string;
    oportunidad?: string;
    dateField?: "assignedAt" | "gestionAt";
    dateStart?: string;
    dateEnd?: string;
    colorFilter?: "red" | "green";
    page?: number;
    pageSize?: number;
    sortKey?: string;
    sortDir?: "asc" | "desc";
  } = {}
) {
  const qs = new URLSearchParams();
  if (query.status) {
    if (Array.isArray(query.status)) {
      query.status.forEach(s => qs.append("status", s));
    } else {
      qs.set("status", query.status);
    }
  }
  if (query.assigneeId) qs.set("assigneeId", query.assigneeId);
  if (query.search) qs.set("search", query.search);
  if (query.gestor) qs.set("gestor", query.gestor);
  if (query.oportunidad) qs.set("oportunidad", query.oportunidad);
  if (query.dateField) qs.set("dateField", query.dateField);
  if (query.dateStart) qs.set("dateStart", query.dateStart);
  if (query.dateEnd) qs.set("dateEnd", query.dateEnd);
  if (query.colorFilter) qs.set("colorFilter", query.colorFilter);
  if (query.page) qs.set("page", String(query.page));
  if (query.pageSize) qs.set("pageSize", String(query.pageSize));
  if (query.sortKey) qs.set("sortKey", query.sortKey);
  if (query.sortDir) qs.set("sortDir", query.sortDir);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: WorkOrderListItem[]; total: number; page: number; pageSize: number }>(
    `/work-orders${suffix}`,
    { token }
  );
}

export async function listGestores(token: string) {
  return apiFetch<string[]>("/work-orders/gestores", { token });
}

export async function listOportunidades(token: string) {
  return apiFetch<string[]>("/work-orders/oportunidades", { token });
}

export async function getWorkOrderMetrics(
  token: string,
  query: {
    status?: WorkOrderStatus | WorkOrderStatus[];
    assigneeId?: string;
    search?: string;
    gestor?: string;
    oportunidad?: string;
    dateField?: "assignedAt" | "gestionAt";
    dateStart?: string;
    dateEnd?: string;
    colorFilter?: "red" | "green";
  } = {}
) {
  const qs = new URLSearchParams();
  if (query.status) {
    if (Array.isArray(query.status)) query.status.forEach((s) => qs.append("status", s));
    else qs.set("status", query.status);
  }
  if (query.assigneeId) qs.set("assigneeId", query.assigneeId);
  if (query.search) qs.set("search", query.search);
  if (query.gestor) qs.set("gestor", query.gestor);
  if (query.oportunidad) qs.set("oportunidad", query.oportunidad);
  if (query.dateField) qs.set("dateField", query.dateField);
  if (query.dateStart) qs.set("dateStart", query.dateStart);
  if (query.dateEnd) qs.set("dateEnd", query.dateEnd);
  if (query.colorFilter) qs.set("colorFilter", query.colorFilter);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{
    total: number;
    cumplan: number;
    noCumplan: number;
    ansPct: number;
    asignadas: number;
    enEjecucion: number;
    pausadas: number;
    gestionadas: number;
    facturadas: number;
    cerradas: number;
    devueltas: number;
  }>(`/work-orders/metrics${suffix}`, { token });
}

export async function listLevantamientos(
  token: string,
  query: {
    search?: string;
    nivelTension?: string;
    asignacionStart?: string;
    asignacionEnd?: string;
    diasAsignaColor?: "red" | "green";
    diasAprobacionPostColor?: "red" | "green";
    diasCierreColor?: "red" | "green";
    diasGestionTotalColor?: "red" | "green";
    page?: number;
    pageSize?: number;
    sortKey?:
      | "orderCode"
      | "nivelTension"
      | "estado"
      | "subestado"
      | "fechaAsignacion"
      | "fechaGestion"
      | "diasAsigna"
      | "diasAprobacionPost"
      | "diasCierre"
      | "diasGestionTotal";
    sortDir?: "asc" | "desc";
  } = {}
) {
  const qs = new URLSearchParams();
  if (query.search) qs.set("search", query.search);
  if (query.nivelTension) qs.set("nivelTension", query.nivelTension);
  if (query.asignacionStart) qs.set("asignacionStart", query.asignacionStart);
  if (query.asignacionEnd) qs.set("asignacionEnd", query.asignacionEnd);
  if (query.diasAsignaColor) qs.set("diasAsignaColor", query.diasAsignaColor);
  if (query.diasAprobacionPostColor) qs.set("diasAprobacionPostColor", query.diasAprobacionPostColor);
  if (query.diasCierreColor) qs.set("diasCierreColor", query.diasCierreColor);
  if (query.diasGestionTotalColor) qs.set("diasGestionTotalColor", query.diasGestionTotalColor);
  if (query.page) qs.set("page", String(query.page));
  if (query.pageSize) qs.set("pageSize", String(query.pageSize));
  if (query.sortKey) qs.set("sortKey", query.sortKey);
  if (query.sortDir) qs.set("sortDir", query.sortDir);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<{ items: LevantamientoListItem[]; total: number; page: number; pageSize: number }>(
    `/levantamientos${suffix}`,
    { token }
  );
}

export async function listLevantamientoNivelesTension(token: string) {
  return apiFetch<string[]>("/levantamientos/nivel-tension", { token });
}

export async function createWorkOrder(
  token: string,
  input: {
    title: string;
    description?: string;
    criticality?: WorkOrderCriticality;
    estimatedMinutes?: number;
    dueAt?: string;
    assigneeId?: string;
  }
) {
  return apiFetch<WorkOrderListItem>("/work-orders", {
    token,
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getWorkOrder(token: string, id: string) {
  return apiFetch<WorkOrderDetails>(`/work-orders/${encodeURIComponent(id)}`, { token });
}

export async function updateWorkOrder(
  token: string,
  id: string,
  patch: {
    title?: string;
    description?: string;
    criticality?: WorkOrderCriticality;
    estimatedMinutes?: number | null;
    dueAt?: string | null;
    assigneeId?: string | null;
  }
) {
  return apiFetch<WorkOrderListItem>(`/work-orders/${encodeURIComponent(id)}`, {
    token,
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export async function transitionWorkOrder(
  token: string,
  id: string,
  input: { toStatus: WorkOrderStatus; note?: string }
) {
  return apiFetch<WorkOrderListItem>(`/work-orders/${encodeURIComponent(id)}/transition`, {
    token,
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateNovedad(
  token: string,
  orderId: string,
  novedadId: string,
  input: { fechaFin: string; detalle?: string }
) {
  await apiFetch<unknown>(`/work-orders/${orderId}/novedades/${novedadId}`, {
    token,
    method: "PATCH",
    body: JSON.stringify(input)
  });
}
