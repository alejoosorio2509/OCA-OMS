import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { WorkOrderCriticality, WorkOrderDetails, WorkOrderStatus } from "../api";
import { getWorkOrder, transitionWorkOrder, updateNovedad } from "../api";
import { useAuth } from "../auth";
import { API_URL } from "../apiUrl";

function NovedadItem({ novedad, orderId, onUpdated }: { 
  novedad: WorkOrderDetails["novedades"][0], 
  orderId: string, 
  onUpdated: () => void 
}) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [fechaFin, setFechaFin] = useState("");
  const [detalle, setDetalle] = useState(novedad.detalle);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!fechaFin) return;
    setSaving(true);
    try {
      await updateNovedad(token!, orderId, novedad.id, { fechaFin, detalle });
      setEditing(false);
      onUpdated();
    } catch {
      alert("No se pudo actualizar la novedad.");
    } finally {
      setSaving(false);
    }
  }

  const isClosed = !!novedad.fechaFin;

  return (
    <div style={{ border: "1px solid #eee", padding: 10, borderRadius: 6, backgroundColor: isClosed ? "#f9f9f9" : "#fff8e1" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div>
          <div style={{ fontWeight: "bold", fontSize: "0.95rem" }}>{novedad.descripcion}</div>
          <div style={{ fontSize: "0.85rem", color: "#666" }}>
            Inicio: {fmtDate(novedad.fechaInicio)} | 
            Fin: {isClosed ? fmtDate(novedad.fechaFin) : <span style={{ color: "orange", fontWeight: "bold" }}>Pausado</span>}
          </div>
        </div>
        {!isClosed && !editing && (
          <button className="btn btn-sm" onClick={() => setEditing(true)}>Cerrar Novedad</button>
        )}
      </div>
      
      {editing ? (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <div className="field">
            <label>Fecha Fin *</label>
            <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} />
          </div>
          <div className="field">
            <label>Detalle / Observación</label>
            <textarea value={detalle} onChange={e => setDetalle(e.target.value)} />
          </div>
          <div className="actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancelar</button>
            <button className="btn btn-sm" disabled={!fechaFin || saving} onClick={handleSave}>
              {saving ? "Guardando..." : "Guardar y Reanudar"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 6, fontSize: "0.9rem", color: "#444" }}>
          {novedad.detalle}
        </div>
      )}
    </div>
  );
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  
  // Si la cadena original no tiene "T" (es solo fecha YYYY-MM-DD), mostrar solo fecha
  if (value.length <= 10 && !value.includes("T")) {
    return d.toLocaleDateString();
  }
  
  return d.toLocaleString();
}

const BOGOTA_TZ = "America/Bogota";
const bogotaDateOnlyFmt = new Intl.DateTimeFormat("es-CO", { timeZone: BOGOTA_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

function fmtDateOnlyBogota(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return bogotaDateOnlyFmt.format(d);
}

function toKebab(value: string) {
  return value.toLowerCase().replaceAll("_", "-");
}

export function OrderDetailsPage() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const backTo = (location.state as { from?: unknown } | null | undefined)?.from;

  const [order, setOrder] = useState<WorkOrderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const statusLabels: Record<WorkOrderStatus, string> = {
    CREATED: "Creada",
    ASSIGNED: "Asignada",
    IN_PROGRESS: "En ejecución",
    ON_HOLD: "En pausa",
    COMPLETED: "Completada",
    CANCELLED: "Cancelada",
    EXCLUDED: "Excluido",
    FACTURADA: "Facturada",
    GESTIONADA: "Gestionada",
    CERRADA: "Cerrada",
    ASIGNADA: "Asignada",
    EN_EJECUCION: "En Ejecución",
    DEVUELTA: "Devuelta",
    DRAFT: "Borrador"
  };

  const criticalityLabels: Record<WorkOrderCriticality, string> = {
    LOW: "Baja",
    MEDIUM: "Media",
    HIGH: "Alta",
    CRITICAL: "Crítica"
  };

  const historySoporteUrl = (h: WorkOrderDetails["history"][0]) => {
    if (!order) return null;
    const note = (h.note ?? "").trim().toLowerCase();
    if (note === "cierre sait") {
      const p = (h.noteDetail ?? "").trim();
      if (p.startsWith("/")) return `${API_URL}${p}`;
      if (p.startsWith("http://") || p.startsWith("https://")) return p;
      return null;
    }
    const dayKey = (value: string | null) => {
      if (!value) return null;
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      return null;
    };

    const startKey = dayKey(h.fechaInicio);
    const endKey = dayKey(h.fechaFin);
    const nov = order.novedades.find((n) => {
      if (!n.soportePath) return false;
      if ((n.descripcion ?? "") !== (h.note ?? "")) return false;
      if ((n.detalle ?? "") !== (h.noteDetail ?? "")) return false;
      const nStartKey = dayKey(n.fechaInicio);
      const nEndKey = dayKey(n.fechaFin);
      return nStartKey === startKey && nEndKey === endKey;
    });
    return nov?.soportePath ? `${API_URL}${nov.soportePath}` : null;
  };

  async function refresh() {
    const data = await getWorkOrder(token!, id!);
    setOrder(data);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getWorkOrder(token!, id!)])
      .then(([o]) => {
        if (cancelled) return;
        setOrder(o);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo cargar la orden.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, id]);

  async function doTransition(toStatus: WorkOrderStatus) {
    if (!order) return;
    setSaving(true);
    setError(null);
    try {
      await transitionWorkOrder(token!, order.id, { toStatus, note: note.trim() || undefined });
      setNote("");
      await refresh();
    } catch {
      setError("No se pudo cambiar el estado.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="card">Cargando...</div>;
  if (error) return <div className="card error">{error}</div>;
  if (!order) return <div className="card">No se encontró la orden.</div>;
  const canExclude = user?.role === "ADMIN";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#bdbdbd", fontSize: 13 }}>
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  if (typeof backTo === "string" && backTo.startsWith("/")) {
                    navigate(backTo);
                    return;
                  }
                  navigate(-1);
                }}
              >
                ← Volver
              </button>
            </div>
            <h2 style={{ margin: "6px 0" }}>
              {order.code} — {order.title}
            </h2>
            <div className="row" style={{ marginTop: 10 }}>
              <span className={`badge status-${toKebab(order.estadoSecundario === "POSTPROCESO" ? "POSTPROCESO" : order.status)}`}>
                {order.estadoSecundario === "POSTPROCESO" ? "Postproceso" : (statusLabels[order.status] || order.status)}
              </span>
              <span className={`badge crit-${toKebab(order.criticality)}`}>
                {criticalityLabels[order.criticality] || order.criticality}
              </span>
              {order.dueAt && <span className={`badge ${order.overdue ? "overdue" : ""}`}>Vence: {fmtDate(order.dueAt)}</span>}
              {order.compliant !== null && (
                <span className={`badge ${order.compliant ? "compliant" : "overdue"}`}>
                  {order.compliant ? "Cumplida a tiempo" : "Fuera de tiempo"}
                </span>
              )}
            </div>
          </div>
          <div style={{ minWidth: 240 }}>
            <div style={{ color: "#bdbdbd" }}>Gestor</div>
            <div>
              {order.gestorNombre || "—"} {order.gestorCc ? `(${order.gestorCc})` : ""}
            </div>
            <div style={{ color: "#bdbdbd", marginTop: 8 }}>Oportunidad / ANS</div>
            <div>{order.oportunidad || "—"} / {order.ansOportunidad || "—"} días</div>
          </div>
        </div>

        <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 12 }}>
          <div style={{ color: "#bdbdbd", marginBottom: 4 }}>Descripción de la orden</div>
          <div style={{ whiteSpace: "pre-wrap", minHeight: 40 }}>{order.description || "Sin descripción."}</div>
        </div>
      </div>

      {order.levantamiento ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Levantamiento (cargue)</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(220px, 1fr))", gap: 10 }}>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Orden Trabajo</div><div style={{ fontWeight: 700 }}>{order.levantamiento.orderCode}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Nivel de Tensión</div><div>{order.levantamiento.nivelTension || "—"}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Tipo</div><div>{order.levantamiento.tipo || "—"}</div></div>

            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Unidad Solicitante</div><div>{order.levantamiento.unidadSolicitante || "—"}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Proyecto</div><div>{order.levantamiento.proyecto || "—"}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Estado</div><div>{order.levantamiento.estado || "—"}</div></div>

            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Subestado</div><div>{order.levantamiento.subestado || "—"}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Subestación</div><div>{order.levantamiento.subestacion || "—"}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Circuito</div><div>{order.levantamiento.circuito || "—"}</div></div>

            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>No Cd</div><div>{order.levantamiento.noCd || "—"}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Dirección</div><div>{order.levantamiento.direccion || "—"}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Municipio</div><div>{order.levantamiento.municipio || "—"}</div></div>

            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Zona</div><div>{order.levantamiento.zona || "—"}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Alcance</div><div>{order.levantamiento.alcance || "—"}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Fecha Solicitud</div><div>{fmtDate(order.levantamiento.fechaSolicitud)}</div></div>

            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Fecha Aprobación Alcance ST</div><div>{fmtDate(order.levantamiento.fechaAprobacionAlcanceSt)}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Fecha Estimación de Costos</div><div>{fmtDate(order.levantamiento.fechaEstimacionCostos)}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Fecha Aprobación Valorización ST</div><div>{fmtDate(order.levantamiento.fechaAprobacionValorizacionSt)}</div></div>

            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Fecha Prevalidación</div><div>{fmtDate(order.levantamiento.fechaPrevalidacion)}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Fecha Asignación</div><div>{fmtDateOnlyBogota(order.levantamiento.fechaAsignacion)}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Fecha Primer Elemento</div><div>{fmtDateOnlyBogota(order.levantamiento.fechaPrimerElemento)}</div></div>

            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Fecha Entrega Postproceso</div><div>{fmtDateOnlyBogota(order.levantamiento.fechaEntregaPostproceso)}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Fecha Aprobación Postproceso</div><div>{fmtDateOnlyBogota(order.levantamiento.fechaAprobacionPostproceso)}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Fecha Gestión</div><div>{fmtDateOnlyBogota(order.levantamiento.fechaGestion)}</div></div>

            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Fecha Devolución</div><div>{fmtDate(order.levantamiento.fechaDevolucion)}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Usuario Solicitante</div><div>{order.levantamiento.usuarioSolicitante || "—"}</div></div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Usuario Asigna</div><div>{order.levantamiento.usuarioAsigna || "—"}</div></div>

            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Gestor</div><div>{order.levantamiento.gestor || "—"}</div></div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>Observación Gestor</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{order.levantamiento.observacionGestor || "—"}</div>
            </div>
            <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Cuadrilla</div><div>{order.levantamiento.cuadrilla || "—"}</div></div>
          </div>
        </div>
      ) : null}

      {canExclude ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Exclusión</h3>
          <div className="field">
            <label>Observación de la exclusión</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Breve motivo de la exclusión..."
            />
          </div>
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn btn-danger" disabled={saving || !note.trim()} onClick={() => doTransition("EXCLUDED")}>
              Cambiar estado a Excluido
            </button>
          </div>
        </div>
      ) : null}

      {order.novedades.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Novedades</h3>
          <div style={{ display: "grid", gap: 10 }}>
            {order.novedades.map((n) => (
              <NovedadItem key={n.id} novedad={n} orderId={order.id} onUpdated={refresh} />
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Historial</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Fecha Registro</th>
                <th>Inicio Novedad</th>
                <th>Fin Novedad</th>
                <th>Días</th>
                <th>Soporte</th>
                <th>Descripción</th>
                <th>Detalle</th>
                <th>Por</th>
              </tr>
            </thead>
            <tbody>
              {order.history.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ color: "#bdbdbd", textAlign: "center" }}>
                    Sin historial.
                  </td>
                </tr>
              ) : (
                order.history.map((h) => (
                  <tr key={h.id}>
                    <td>{fmtDate(h.changedAt)}</td>
                    <td>{fmtDate(h.fechaInicio)}</td>
                    <td>{fmtDate(h.fechaFin)}</td>
                    <td>{h.diasNovedad !== null ? h.diasNovedad : "—"}</td>
                    <td>
                      {(() => {
                        const url = historySoporteUrl(h);
                        if (!url) return "—";
                        return (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <a href={url} target="_blank" rel="noreferrer">Ver</a>
                            <a href={url} download>Descargar</a>
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      {h.note || (
                        <span className={`badge status-${toKebab(h.toStatus)}`}>
                          {statusLabels[h.toStatus] || h.toStatus}
                        </span>
                      )}
                    </td>
                    <td style={{ maxWidth: 250, whiteSpace: "normal", fontSize: "0.9rem" }}>{h.noteDetail || "—"}</td>
                    <td>{h.changedBy?.name || "Sistema"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
