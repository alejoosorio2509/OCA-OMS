import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { getGestoresSummary, listWorkOrders, type GestorSummary, type WorkOrderListItem, type WorkOrderStatus } from "../api";
import { API_URL } from "../apiUrl";
import "./ProgramacionPage.css";
import { useNavigate } from "react-router-dom";

const statusLabels: Record<WorkOrderStatus, string> = {
  DRAFT: "Borrador",
  CREATED: "Creada",
  ASSIGNED: "Asignada",
  IN_PROGRESS: "En curso",
  ON_HOLD: "Pausada",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
  EXCLUDED: "Excluida",
  FACTURADA: "Facturada",
  GESTIONADA: "Gestionada",
  CERRADA: "Cerrada",
  ASIGNADA: "Asignada",
  EN_EJECUCION: "En ejecución",
  DEVUELTA: "Devuelta"
};

const cardStatusOrder: WorkOrderStatus[] = [
  "ASIGNADA",
  "ASSIGNED",
  "EN_EJECUCION",
  "IN_PROGRESS",
  "ON_HOLD",
  "DEVUELTA",
  "EXCLUDED",
  "CREATED",
  "DRAFT",
  "COMPLETED",
  "CANCELLED"
];

function statusClassName(status: WorkOrderStatus) {
  return status.toLowerCase().replaceAll("_", "-");
}

function activeLoadCount(summary: GestorSummary) {
  return (
    (summary.statusCounts?.ASIGNADA ?? 0) +
    (summary.statusCounts?.ASSIGNED ?? 0) +
    (summary.statusCounts?.EN_EJECUCION ?? 0) +
    (summary.statusCounts?.IN_PROGRESS ?? 0)
  );
}

const ACTIVE_STATUSES: WorkOrderStatus[] = ["ASIGNADA", "ASSIGNED", "EN_EJECUCION", "IN_PROGRESS"];

const ALL_PAGE_SIZE = 20;

type OrderSortKey = "code" | "title" | "status" | "gestor" | "assignedAt" | "diasGestion" | "cumplimiento";

const cumplimientoRank = (value: WorkOrderListItem["cumplimiento"]) => {
  if (value === "Cumple") return 1;
  if (value === "No cumple") return 2;
  return 3;
};

function compareOrders(a: WorkOrderListItem, b: WorkOrderListItem, key: OrderSortKey): number {
  switch (key) {
    case "code":
      return a.code.localeCompare(b.code, undefined, { numeric: true });
    case "title":
      return a.title.localeCompare(b.title);
    case "status":
      return statusLabels[a.status].localeCompare(statusLabels[b.status]);
    case "gestor":
      return (a.gestorNombre ?? "").localeCompare(b.gestorNombre ?? "");
    case "assignedAt":
      return (a.assignedAt ? new Date(a.assignedAt).getTime() : 0) - (b.assignedAt ? new Date(b.assignedAt).getTime() : 0);
    case "diasGestion":
      return (a.diasGestion ?? -999999) - (b.diasGestion ?? -999999);
    case "cumplimiento":
      return cumplimientoRank(a.cumplimiento) - cumplimientoRank(b.cumplimiento);
  }
}

function sortOrders(orders: WorkOrderListItem[], key: OrderSortKey, dir: "asc" | "desc") {
  return [...orders].sort((a, b) => {
    let result = compareOrders(a, b, key);
    if (result === 0) result = a.code.localeCompare(b.code, undefined, { numeric: true });
    return dir === "asc" ? result : -result;
  });
}

export function ProgramacionPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const canProgramacion = user?.role === "ADMIN" || !!user?.canProgramacion;
  const canOrders = user?.role === "ADMIN" || !!user?.canOrders;
  const [summaries, setSummaries] = useState<GestorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedGestor, setSelectedGestor] = useState<string | null>(null);
  const [gestorOrders, setGestorOrders] = useState<WorkOrderListItem[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState<"" | WorkOrderStatus>("");
  const [gestorSortMode, setGestorSortMode] = useState<"alpha" | "activeLoad">("alpha");
  const [gestorSortDir, setGestorSortDir] = useState<"asc" | "desc">("asc");
  const [orderSortKey, setOrderSortKey] = useState<OrderSortKey>("assignedAt");
  const [orderSortDir, setOrderSortDir] = useState<"asc" | "desc">("desc");

  const [allOrders, setAllOrders] = useState<WorkOrderListItem[]>([]);
  const [loadingAllOrders, setLoadingAllOrders] = useState(true);
  const [allSearch, setAllSearch] = useState("");
  const [allSearchDebounced, setAllSearchDebounced] = useState("");
  const [allSortKey, setAllSortKey] = useState<OrderSortKey>("assignedAt");
  const [allSortDir, setAllSortDir] = useState<"asc" | "desc">("desc");
  const [allPage, setAllPage] = useState(1);
  const [allTotal, setAllTotal] = useState(0);
  const [assignedOver15, setAssignedOver15] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    loadSummary();
  }, [token]);

  useEffect(() => {
    const timer = setTimeout(() => setAllSearchDebounced(allSearch), 400);
    return () => clearTimeout(timer);
  }, [allSearch]);

  useEffect(() => {
    loadAllOrders();
  }, [token, allSearchDebounced, allSortKey, allSortDir, allPage, assignedOver15]);

  async function loadAllOrders() {
    try {
      setLoadingAllOrders(true);
      const data = await listWorkOrders(token!, {
        status: ACTIVE_STATUSES,
        page: allPage,
        pageSize: ALL_PAGE_SIZE,
        search: allSearchDebounced.trim() || undefined,
        minDiasGestion: assignedOver15 ? 15 : undefined,
        sortKey: allSortKey === "gestor" ? "gestorNombre" : allSortKey,
        sortDir: allSortDir
      });
      setAllOrders(data.items);
      setAllTotal(data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingAllOrders(false);
    }
  }

  async function handleExport() {
    if (!token) return;
    setExportError(null);
    setExporting(true);
    try {
      const qs = new URLSearchParams();
      ACTIVE_STATUSES.forEach((s) => qs.append("status", s));
      if (allSearchDebounced.trim()) qs.set("search", allSearchDebounced.trim());
      if (assignedOver15) qs.set("minDiasGestion", "15");
      const res = await fetch(`${API_URL}/work-orders/export.csv?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("EXPORT_FAILED");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "programacion_ordenes.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("No se pudo exportar el listado.");
    } finally {
      setExporting(false);
    }
  }

  async function loadSummary() {
    try {
      setLoading(true);
      const data = await getGestoresSummary(token!);
      setSummaries(data);
      setError(null);
    } catch (e) {
      setError("Error al cargar el resumen de gestores");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleGestorClick(gestorNombre: string) {
    if (selectedGestor === gestorNombre) {
      setSelectedGestor(null);
      return;
    }
    
    setSelectedGestor(gestorNombre);
    setOrderSearch("");
    setOrderStatusFilter("");
    setLoadingOrders(true);
    try {
      const activeStatuses: WorkOrderStatus[] = [
        "DRAFT", "CREATED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", 
        "COMPLETED", "CANCELLED", "EXCLUDED", "ASIGNADA", "EN_EJECUCION", "DEVUELTA"
      ];
      const data = await listWorkOrders(token!, { 
        gestor: gestorNombre, 
        pageSize: 100,
        status: activeStatuses
      });
      setGestorOrders(data.items);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingOrders(false);
    }
  }

  const sortedSummaries = useMemo(() => {
    const items = [...summaries];
    if (gestorSortMode === "activeLoad") {
      items.sort((a, b) => {
        const diff = activeLoadCount(a) - activeLoadCount(b);
        if (diff !== 0) return diff;
        return a.gestorNombre.localeCompare(b.gestorNombre);
      });
      return gestorSortDir === "asc" ? items : items.reverse();
    }

    items.sort((a, b) => a.gestorNombre.localeCompare(b.gestorNombre));
    return gestorSortDir === "asc" ? items : items.reverse();
  }, [summaries, gestorSortDir, gestorSortMode]);

  const availableOrderStatuses = Array.from(new Set(gestorOrders.map((order) => order.status)))
    .sort((a, b) => statusLabels[a].localeCompare(statusLabels[b]));

  const handleOrderSort = (key: OrderSortKey) => {
    if (orderSortKey === key) {
      setOrderSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setOrderSortKey(key);
    setOrderSortDir(key === "assignedAt" || key === "diasGestion" ? "desc" : "asc");
  };

  const sortIndicator = (key: OrderSortKey) => {
    if (orderSortKey !== key) return "↕";
    return orderSortDir === "asc" ? "↑" : "↓";
  };

  const handleAllSort = (key: OrderSortKey) => {
    setAllPage(1);
    if (allSortKey === key) {
      setAllSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setAllSortKey(key);
    setAllSortDir(key === "assignedAt" || key === "diasGestion" ? "desc" : "asc");
  };

  const allSortIndicator = (key: OrderSortKey) => {
    if (allSortKey !== key) return "↕";
    return allSortDir === "asc" ? "↑" : "↓";
  };

  const filteredGestorOrders = useMemo(() => {
    const filtered = gestorOrders.filter((order) => {
      const matchesSearch =
        !orderSearch.trim() ||
        order.code.toLowerCase().includes(orderSearch.trim().toLowerCase()) ||
        order.title.toLowerCase().includes(orderSearch.trim().toLowerCase());
      const matchesStatus = !orderStatusFilter || order.status === orderStatusFilter;
      return matchesSearch && matchesStatus;
    });

    return sortOrders(filtered, orderSortKey, orderSortDir);
  }, [gestorOrders, orderSearch, orderStatusFilter, orderSortKey, orderSortDir]);

  const allTotalPages = Math.max(1, Math.ceil(allTotal / ALL_PAGE_SIZE));

  if (!canProgramacion) return <div className="card">No autorizado.</div>;
  if (loading) return <div className="programacion-page">Cargando...</div>;
  if (error) return <div className="programacion-page error">{error}</div>;

  return (
    <div className="programacion-page">
      <h1>Programación por Gestor</h1>
      <p>Resumen de carga de trabajo por responsable.</p>
      <div className="programacion-toolbar">
        <label className="programacion-sort">
          <span>Ordenar gestores por</span>
          <select
            value={gestorSortMode}
            onChange={(e) => {
              const nextMode = e.target.value as "alpha" | "activeLoad";
              setGestorSortMode(nextMode);
              setGestorSortDir(nextMode === "activeLoad" ? "desc" : "asc");
            }}
          >
            <option value="alpha">Orden alfabético</option>
            <option value="activeLoad">Asignadas + En ejecución</option>
          </select>
        </label>
        <label className="programacion-sort">
          <span>Sentido</span>
          <select value={gestorSortDir} onChange={(e) => setGestorSortDir(e.target.value as "asc" | "desc")}>
            <option value="asc">{gestorSortMode === "activeLoad" ? "Menor a mayor" : "A - Z"}</option>
            <option value="desc">{gestorSortMode === "activeLoad" ? "Mayor a menor" : "Z - A"}</option>
          </select>
        </label>
      </div>

      <div className="gestores-grid">
        {sortedSummaries.map((g) => (
          <div 
            key={g.gestorNombre} 
            className={`gestor-card ${selectedGestor === g.gestorNombre ? "active" : ""}`}
            onClick={() => handleGestorClick(g.gestorNombre)}
          >
            <div className="gestor-header">
              <div className="gestor-icon">👤</div>
              <div className="gestor-info">
                <h3 className="gestor-name">{g.gestorNombre}</h3>
                <p className="gestor-code">{g.gestorCc ? `Cédula: ${g.gestorCc}` : "Sin código"}</p>
              </div>
              <div className="gestor-arrow">
                {selectedGestor === g.gestorNombre ? "▼" : "▶"}
              </div>
            </div>
            <div className="gestor-stats">
              <div className="stat-badge total">
                <span>📊</span> {g.total} Total
              </div>
              <div className="stat-badge active-load">
                <span>⚙️</span> {activeLoadCount(g)} Asignadas + En ejecución
              </div>
              {cardStatusOrder
                .filter((status) => (g.statusCounts?.[status] ?? 0) > 0)
                .map((status) => (
                  <div key={status} className={`stat-badge status-${statusClassName(status)}`}>
                    <span>{g.statusCounts?.[status] ?? 0}</span> {statusLabels[status]}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      <section className="consolidated-section">
        <div className="consolidated-header">
          <div>
            <h2>Órdenes Asignadas + En ejecución</h2>
            <p>Detalle consolidado de todos los gestores.</p>
          </div>
          <div className="consolidated-controls">
            <input
              value={allSearch}
              onChange={(e) => {
                setAllSearch(e.target.value);
                setAllPage(1);
              }}
              placeholder="Buscar por OT, título o gestor..."
              className="drawer-search"
            />
            <button
              type="button"
              className={`drawer-filter-chip ${assignedOver15 ? "active" : ""}`}
              onClick={() => {
                setAssignedOver15((current) => !current);
                setAllPage(1);
              }}
            >
              Asignadas &gt; 15 días
            </button>
            <button type="button" className="btn" onClick={handleExport} disabled={exporting}>
              {exporting ? "Exportando..." : "Exportar"}
            </button>
          </div>
        </div>

        {exportError ? <p className="export-error">{exportError}</p> : null}

        {loadingAllOrders ? (
          <p>Cargando órdenes...</p>
        ) : allOrders.length === 0 ? (
          <p>No hay órdenes asignadas o en ejecución.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th><button type="button" className="panel-sort-button" onClick={() => handleAllSort("gestor")}>Gestor <span>{allSortIndicator("gestor")}</span></button></th>
                  <th><button type="button" className="panel-sort-button" onClick={() => handleAllSort("code")}>OT <span>{allSortIndicator("code")}</span></button></th>
                  <th><button type="button" className="panel-sort-button" onClick={() => handleAllSort("title")}>Título <span>{allSortIndicator("title")}</span></button></th>
                  <th><button type="button" className="panel-sort-button" onClick={() => handleAllSort("status")}>Estado <span>{allSortIndicator("status")}</span></button></th>
                  <th><button type="button" className="panel-sort-button" onClick={() => handleAllSort("assignedAt")}>Asignación <span>{allSortIndicator("assignedAt")}</span></button></th>
                  <th><button type="button" className="panel-sort-button" onClick={() => handleAllSort("diasGestion")}>Días Gestión <span>{allSortIndicator("diasGestion")}</span></button></th>
                  <th><button type="button" className="panel-sort-button" onClick={() => handleAllSort("cumplimiento")}>Cumplimiento <span>{allSortIndicator("cumplimiento")}</span></button></th>
                </tr>
              </thead>
              <tbody>
                {allOrders.map((o) => (
                  <tr key={o.id} className="order-row">
                    <td>{o.gestorNombre ?? "—"}</td>
                    <td>
                      {canOrders ? (
                        <button
                          type="button"
                          className="order-link-button"
                          onClick={() => navigate(`/orders/${o.id}`)}
                          title="Ver detalle de la orden"
                        >
                          <strong className="order-code">{o.code}</strong>
                        </button>
                      ) : (
                        <strong className="order-code">{o.code}</strong>
                      )}
                    </td>
                    <td>{o.title}</td>
                    <td>
                      <span className={`badge-status-box ${statusClassName(o.status)}`}>
                        {statusLabels[o.status]}
                      </span>
                    </td>
                    <td>{o.assignedAt ? new Date(o.assignedAt).toLocaleDateString() : "—"}</td>
                    <td>
                      <span className="days-count">
                        {o.diasGestion ?? 0} {Math.abs(o.diasGestion ?? 0) === 1 ? "día" : "días"}
                      </span>
                    </td>
                    <td>
                      {o.cumplimiento ? (
                        <span className={`compliance-tag ${o.cumplimiento.toLowerCase().replace(" ", "-")}`}>
                          {o.cumplimiento}
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="consolidated-pagination">
              <span>
                {allTotal} {allTotal === 1 ? "orden" : "órdenes"} · Página {allPage} de {allTotalPages}
              </span>
              <div className="pagination-actions">
                <button
                  type="button"
                  className="pagination-button"
                  disabled={allPage <= 1}
                  onClick={() => setAllPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="pagination-button"
                  disabled={allPage >= allTotalPages}
                  onClick={() => setAllPage((p) => Math.min(allTotalPages, p + 1))}
                >
                  Siguiente
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {selectedGestor && (
        <div className="orders-panel-overlay" onClick={() => setSelectedGestor(null)}>
          <aside className="orders-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>Órdenes de {selectedGestor}</h2>
              <button className="btn-close" onClick={() => setSelectedGestor(null)}>Cerrar</button>
            </div>

            {loadingOrders ? (
              <p>Cargando órdenes...</p>
            ) : gestorOrders.length === 0 ? (
              <p>No hay órdenes asignadas.</p>
            ) : (
              <div className="table-container">
                <div className="drawer-filters">
                  <div className="drawer-controls-row">
                    <input
                      value={orderSearch}
                      onChange={(e) => setOrderSearch(e.target.value)}
                      placeholder="Buscar por OT o título..."
                      className="drawer-search"
                    />
                  </div>
                  <div className="drawer-statuses">
                    <button
                      type="button"
                      className={`drawer-filter-chip ${orderStatusFilter === "" ? "active" : ""}`}
                      onClick={() => setOrderStatusFilter("")}
                    >
                      Todas ({gestorOrders.length})
                    </button>
                    {availableOrderStatuses.map((status) => {
                      const count = gestorOrders.filter((order) => order.status === status).length;
                      return (
                        <button
                          key={status}
                          type="button"
                          className={`drawer-filter-chip ${orderStatusFilter === status ? "active" : ""}`}
                          onClick={() => setOrderStatusFilter(status)}
                        >
                          {statusLabels[status]} ({count})
                        </button>
                      );
                    })}
                  </div>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th><button type="button" className="panel-sort-button" onClick={() => handleOrderSort("code")}>OT <span>{sortIndicator("code")}</span></button></th>
                      <th><button type="button" className="panel-sort-button" onClick={() => handleOrderSort("title")}>Título <span>{sortIndicator("title")}</span></button></th>
                      <th><button type="button" className="panel-sort-button" onClick={() => handleOrderSort("status")}>Estado <span>{sortIndicator("status")}</span></button></th>
                      <th><button type="button" className="panel-sort-button" onClick={() => handleOrderSort("assignedAt")}>Asignación <span>{sortIndicator("assignedAt")}</span></button></th>
                      <th><button type="button" className="panel-sort-button" onClick={() => handleOrderSort("diasGestion")}>Días Gestión <span>{sortIndicator("diasGestion")}</span></button></th>
                      <th><button type="button" className="panel-sort-button" onClick={() => handleOrderSort("cumplimiento")}>Cumplimiento <span>{sortIndicator("cumplimiento")}</span></button></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGestorOrders.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="empty-orders-message">No hay órdenes con ese filtro.</td>
                      </tr>
                    ) : filteredGestorOrders.map((o) => (
                      <tr key={o.id} className="order-row">
                        <td>
                          {canOrders ? (
                            <button
                              type="button"
                              className="order-link-button"
                              onClick={() => navigate(`/orders/${o.id}`)}
                              title="Ver detalle de la orden"
                            >
                              <strong className="order-code">{o.code}</strong>
                            </button>
                          ) : (
                            <strong className="order-code">{o.code}</strong>
                          )}
                        </td>
                        <td>{o.title}</td>
                        <td>
                          <span className={`badge-status-box ${statusClassName(o.status)}`}>
                            {statusLabels[o.status]}
                          </span>
                        </td>
                        <td>{o.assignedAt ? new Date(o.assignedAt).toLocaleDateString() : "—"}</td>
                        <td>
                          <span className="days-count">
                            {o.diasGestion ?? 0} {Math.abs(o.diasGestion ?? 0) === 1 ? "día" : "días"}
                          </span>
                        </td>
                        <td>
                          {o.cumplimiento ? (
                            <span className={`compliance-tag ${o.cumplimiento.toLowerCase().replace(" ", "-")}`}>
                              {o.cumplimiento}
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
