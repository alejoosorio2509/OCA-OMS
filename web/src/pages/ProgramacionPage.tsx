import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { getGestoresSummary, listWorkOrders, type GestorSummary, type WorkOrderListItem, type WorkOrderStatus } from "../api";
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

export function ProgramacionPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
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
  const [orderSortKey, setOrderSortKey] = useState<"code" | "title" | "status" | "assignedAt" | "diasGestion" | "cumplimiento">("assignedAt");
  const [orderSortDir, setOrderSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    loadSummary();
  }, [token]);

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

  const handleOrderSort = (key: "code" | "title" | "status" | "assignedAt" | "diasGestion" | "cumplimiento") => {
    if (orderSortKey === key) {
      setOrderSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setOrderSortKey(key);
    setOrderSortDir(key === "assignedAt" || key === "diasGestion" ? "desc" : "asc");
  };

  const sortIndicator = (key: "code" | "title" | "status" | "assignedAt" | "diasGestion" | "cumplimiento") => {
    if (orderSortKey !== key) return "↕";
    return orderSortDir === "asc" ? "↑" : "↓";
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

    const cumplimientoRank = (value: WorkOrderListItem["cumplimiento"]) => {
      if (value === "Cumple") return 1;
      if (value === "No cumple") return 2;
      return 3;
    };

    filtered.sort((a, b) => {
      let result = 0;

      switch (orderSortKey) {
        case "code":
          result = a.code.localeCompare(b.code, undefined, { numeric: true });
          break;
        case "title":
          result = a.title.localeCompare(b.title);
          break;
        case "status":
          result = statusLabels[a.status].localeCompare(statusLabels[b.status]);
          break;
        case "assignedAt":
          result = (a.assignedAt ? new Date(a.assignedAt).getTime() : 0) - (b.assignedAt ? new Date(b.assignedAt).getTime() : 0);
          break;
        case "diasGestion":
          result = (a.diasGestion ?? -999999) - (b.diasGestion ?? -999999);
          break;
        case "cumplimiento":
          result = cumplimientoRank(a.cumplimiento) - cumplimientoRank(b.cumplimiento);
          break;
      }

      if (result === 0) {
        result = a.code.localeCompare(b.code, undefined, { numeric: true });
      }

      return orderSortDir === "asc" ? result : -result;
    });

    return filtered;
  }, [gestorOrders, orderSearch, orderStatusFilter, orderSortKey, orderSortDir]);

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
                          <button
                            type="button"
                            className="order-link-button"
                            onClick={() => navigate(`/orders/${o.id}`)}
                            title="Ver detalle de la orden"
                          >
                            <strong className="order-code">{o.code}</strong>
                          </button>
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
