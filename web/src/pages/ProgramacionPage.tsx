import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { getGestoresSummary, listWorkOrders, type GestorSummary, type WorkOrderListItem, type WorkOrderStatus } from "../api";
import "./ProgramacionPage.css";
import { Link } from "react-router-dom";

export function ProgramacionPage() {
  const { token } = useAuth();
  const [summaries, setSummaries] = useState<GestorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedGestor, setSelectedGestor] = useState<string | null>(null);
  const [gestorOrders, setGestorOrders] = useState<WorkOrderListItem[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

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
              <div className="stat-badge en-curso">
                <span>⚡</span> {g.enCurso} En curso
              </div>
              <div className="stat-badge pausadas">
                <span>⏸</span> {g.pausadas} Pausadas
              </div>
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
              <table className="table">
                <thead>
                  <tr>
                    <th>OT</th>
                    <th>Título</th>
                    <th>Estado</th>
                    <th>Asignación</th>
                    <th>Días Gestión</th>
                    <th>Cumplimiento</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {gestorOrders.map((o) => (
                    <tr key={o.id}>
                      <td><strong>{o.code}</strong></td>
                      <td>{o.title}</td>
                      <td>
                        <span className={`badge-status-box ${o.status.toLowerCase().replace("_", "-")}`}>
                          {o.status}
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
                      <td>
                        <Link to={`/orders/${o.id}`} className="btn-small">Ver detalle</Link>
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
