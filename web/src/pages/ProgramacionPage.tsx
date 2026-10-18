import { useEffect, useState } from "react";
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

  useEffect(() => {
    loadSummary();
  }, [token]);

  async function loadSummary() {
    try {
      setLoading(true);
      const data = await getGestoresSummary(token!);
      // Ordenar alfabéticamente por nombre de gestor
      const sortedData = [...data].sort((a, b) => 
        a.gestorNombre.localeCompare(b.gestorNombre)
      );
      setSummaries(sortedData);
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

  const availableOrderStatuses = Array.from(new Set(gestorOrders.map((order) => order.status)))
    .sort((a, b) => statusLabels[a].localeCompare(statusLabels[b]));

  const filteredGestorOrders = gestorOrders.filter((order) => {
    const matchesSearch =
      !orderSearch.trim() ||
      order.code.toLowerCase().includes(orderSearch.trim().toLowerCase()) ||
      order.title.toLowerCase().includes(orderSearch.trim().toLowerCase());
    const matchesStatus = !orderStatusFilter || order.status === orderStatusFilter;
    return matchesSearch && matchesStatus;
  });

  if (loading) return <div className="programacion-page">Cargando...</div>;
  if (error) return <div className="programacion-page error">{error}</div>;

  return (
    <div className="programacion-page">
      <h1>Programación por Gestor</h1>
      <p>Resumen de carga de trabajo por responsable.</p>

      <div className="gestores-grid">
        {summaries.map((g) => (
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
        <div className="orders-drawer">
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
                <input
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Buscar por OT o título..."
                  className="drawer-search"
                />
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
                    <th>OT</th>
                    <th>Título</th>
                    <th>Estado</th>
                    <th>Asignación</th>
                    <th>Días Gestión</th>
                    <th>Cumplimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGestorOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="empty-orders-message">No hay órdenes con ese filtro.</td>
                    </tr>
                  ) : filteredGestorOrders.map((o) => (
                    <tr
                      key={o.id}
                      className="order-row"
                      onClick={() => navigate(`/orders/${o.id}`)}
                      title="Ver detalle de la orden"
                    >
                      <td><strong className="order-code">{o.code}</strong></td>
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
        </div>
      )}
    </div>
  );
}
