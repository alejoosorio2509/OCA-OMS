import { useEffect, useMemo, useState } from "react";
import type { LevantamientoListItem } from "../api";
import { listLevantamientoNivelesTension, listLevantamientos } from "../api";
import { useAuth } from "../auth";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { API_URL } from "../apiUrl";

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function fmtVal(value: string | null) {
  return value && value.trim() ? value : "—";
}

function colorOf(v: number | null) {
  if (v === null) return "var(--muted)";
  return "var(--text)";
}

const NOVEDAD_OPCIONES = [
  "Aplicación diagrama unifilar",
  "Aplicación retardada",
  "Asociación de incrementos por BDE",
  "Cambio de propiedad",
  "Creación de componentes",
  "Desalineación STM y QGIS",
  "Desviación Topológica",
  "Error cargue de documentos QGIS",
  "Error elementos borrados",
  "Error SE - Levantamiento de restricciones",
  "Incremento en ticket",
  "Incremento Energy Consumer",
  "Incremento ERROR -20400",
  "Incremento FKC, UNIC",
  "Incremento LOCKED",
  "Incremento OWMC",
  "Incrementos",
  "Indisponibilidad sistema",
  "OT Cancelada por el cliente",
  "Otro",
  "PDL Anulado",
  "PDL con traslado de carga",
  "Pendiente ejecución de otra OT",
  "Pendiente ejecución de otro incremento",
  "Proyectos especiales",
  "Rechazo automático - No reporte STAMS",
  "Rechazo manual inconsistente",
  "Refresh",
  "Retido de CD",
  "Rótulo duplicado",
  "Sincronización AGUI STM AT",
  "Sincronización estado incremento SAIT",
  "Sobre dimensión"
];

export function LevantamientoPage() {
  const { token, user } = useAuth();
  const canOrders = user?.role === "ADMIN" || !!user?.canOrders;
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();

  const initialParams = useMemo(() => {
    const p = new URLSearchParams(location.search);
    if (p.toString()) return p;
    const stored = sessionStorage.getItem("levantamiento_filters");
    return stored ? new URLSearchParams(stored) : p;
  }, [location.search]);

  const initialPage = useMemo(() => {
    const raw = initialParams.get("page");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [initialParams]);

  const [items, setItems] = useState<LevantamientoListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hasSearched, setHasSearched] = useState(() => initialParams.toString().length > 0);
  const [selectedOrder, setSelectedOrder] = useState<{ id: string; code: string } | null>(null);
  const [showNovedadModal, setShowNovedadModal] = useState(false);
  const [showPostprocesoModal, setShowPostprocesoModal] = useState(false);

  const [draftSearch, setDraftSearch] = useState(() => initialParams.get("search") || "");
  const [draftNivelTension, setDraftNivelTension] = useState(() => initialParams.get("nivelTension") || "");
  const [draftAsignacionStart, setDraftAsignacionStart] = useState(() => initialParams.get("asignacionStart") || "");
  const [draftAsignacionEnd, setDraftAsignacionEnd] = useState(() => initialParams.get("asignacionEnd") || "");
  const [nivelesTension, setNivelesTension] = useState<string[]>([]);

  const [draftDiasAsignaColor, setDraftDiasAsignaColor] = useState<"" | "red" | "green">(
    () => (initialParams.get("diasAsignaColor") as "" | "red" | "green" | null) || ""
  );
  const [draftDiasAprobacionPostColor, setDraftDiasAprobacionPostColor] = useState<"" | "red" | "green">(
    () => (initialParams.get("diasAprobacionPostColor") as "" | "red" | "green" | null) || ""
  );
  const [draftDiasCierreColor, setDraftDiasCierreColor] = useState<"" | "red" | "green">(
    () => (initialParams.get("diasCierreColor") as "" | "red" | "green" | null) || ""
  );
  const [draftDiasGestionTotalColor, setDraftDiasGestionTotalColor] = useState<"" | "red" | "green">(
    () => (initialParams.get("diasGestionTotalColor") as "" | "red" | "green" | null) || ""
  );

  type Filters = {
    search: string;
    nivelTension: string;
    asignacionStart: string;
    asignacionEnd: string;
    diasAsignaColor: "" | "red" | "green";
    diasAprobacionPostColor: "" | "red" | "green";
    diasCierreColor: "" | "red" | "green";
    diasGestionTotalColor: "" | "red" | "green";
  };

  const [applied, setApplied] = useState<Filters>(() => ({
    search: initialParams.get("search") || "",
    nivelTension: initialParams.get("nivelTension") || "",
    asignacionStart: initialParams.get("asignacionStart") || "",
    asignacionEnd: initialParams.get("asignacionEnd") || "",
    diasAsignaColor: (initialParams.get("diasAsignaColor") as "" | "red" | "green" | null) || "",
    diasAprobacionPostColor: (initialParams.get("diasAprobacionPostColor") as "" | "red" | "green" | null) || "",
    diasCierreColor: (initialParams.get("diasCierreColor") as "" | "red" | "green" | null) || "",
    diasGestionTotalColor: (initialParams.get("diasGestionTotalColor") as "" | "red" | "green" | null) || ""
  }));

  const [page, setPage] = useState(initialPage);
  const pageSize = 50;

  type SortKey =
    | "fechaAsignacion"
    | "fechaGestion"
    | "orderCode"
    | "nivelTension"
    | "estado"
    | "subestado"
    | "diasAsigna"
    | "diasAprobacionPost"
    | "diasCierre"
    | "diasGestionTotal";

  const [sortKey, setSortKey] = useState<SortKey>(() => (initialParams.get("sortKey") as SortKey | null) || "fechaAsignacion");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => (initialParams.get("sortDir") as "asc" | "desc" | null) || "desc");

  const applyFilters = () => {
    setApplied({
      search: draftSearch,
      nivelTension: draftNivelTension,
      asignacionStart: draftAsignacionStart,
      asignacionEnd: draftAsignacionEnd,
      diasAsignaColor: draftDiasAsignaColor,
      diasAprobacionPostColor: draftDiasAprobacionPostColor,
      diasCierreColor: draftDiasCierreColor,
      diasGestionTotalColor: draftDiasGestionTotalColor
    });
    setHasSearched(true);
    setPage(1);
  };

  const clearFilters = () => {
    setDraftSearch("");
    setDraftNivelTension("");
    setDraftAsignacionStart("");
    setDraftAsignacionEnd("");
    setDraftDiasAsignaColor("");
    setDraftDiasAprobacionPostColor("");
    setDraftDiasCierreColor("");
    setDraftDiasGestionTotalColor("");
    setApplied({
      search: "",
      nivelTension: "",
      asignacionStart: "",
      asignacionEnd: "",
      diasAsignaColor: "",
      diasAprobacionPostColor: "",
      diasCierreColor: "",
      diasGestionTotalColor: ""
    });
    setHasSearched(false);
    setItems([]);
    setTotalCount(0);
    setPage(1);
    sessionStorage.removeItem("levantamiento_filters");
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  useEffect(() => {
    const next = new URLSearchParams();
    if (applied.search.trim()) next.set("search", applied.search.trim());
    if (applied.nivelTension.trim()) next.set("nivelTension", applied.nivelTension.trim());
    if (applied.asignacionStart) next.set("asignacionStart", applied.asignacionStart);
    if (applied.asignacionEnd) next.set("asignacionEnd", applied.asignacionEnd);
    if (applied.diasAsignaColor) next.set("diasAsignaColor", applied.diasAsignaColor);
    if (applied.diasAprobacionPostColor) next.set("diasAprobacionPostColor", applied.diasAprobacionPostColor);
    if (applied.diasCierreColor) next.set("diasCierreColor", applied.diasCierreColor);
    if (applied.diasGestionTotalColor) next.set("diasGestionTotalColor", applied.diasGestionTotalColor);
    if (sortKey) next.set("sortKey", sortKey);
    if (sortDir) next.set("sortDir", sortDir);
    if (page > 1) next.set("page", String(page));
    sessionStorage.setItem("levantamiento_filters", next.toString());
    setSearchParams(next, { replace: true });
  }, [applied, sortKey, sortDir, page, setSearchParams]);

  const query = useMemo(() => {
    return {
      search: applied.search.trim() || undefined,
      nivelTension: applied.nivelTension.trim() || undefined,
      asignacionStart: applied.asignacionStart || undefined,
      asignacionEnd: applied.asignacionEnd || undefined,
      diasAsignaColor: applied.diasAsignaColor || undefined,
      diasAprobacionPostColor: applied.diasAprobacionPostColor || undefined,
      diasCierreColor: applied.diasCierreColor || undefined,
      diasGestionTotalColor: applied.diasGestionTotalColor || undefined,
      page,
      pageSize,
      sortKey,
      sortDir
    };
  }, [applied, page, sortKey, sortDir]);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    listLevantamientoNivelesTension(token)
      .then((data) => {
        if (!cancelled) setNivelesTension(data);
      })
      .catch(() => {
        if (!cancelled) setNivelesTension([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    if (!token || !hasSearched) {
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    listLevantamientos(token, query)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setTotalCount(data.total);
      })
      .catch(() => {
        if (cancelled) return;
        setError("No se pudo cargar el levantamiento.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, query, hasSearched]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      setPage(1);
      return;
    }
    setSortKey(key);
    setSortDir("asc");
    setPage(1);
  };

  if (!canOrders) return <div className="card">No autorizado.</div>;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card">
        <div className="row" style={{ alignItems: "end", gap: 10, flexWrap: "wrap" }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Buscar</label>
            <input value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)} placeholder="Orden Trabajo..." />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Nivel de Tensión</label>
            <select value={draftNivelTension} onChange={(e) => setDraftNivelTension(e.target.value)} style={{ width: "100%" }}>
              <option value="">Todos</option>
              {nivelesTension.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ width: 180 }}>
            <label>Asignación desde</label>
            <input type="date" value={draftAsignacionStart} onChange={(e) => setDraftAsignacionStart(e.target.value)} />
          </div>
          <div className="field" style={{ width: 180 }}>
            <label>Asignación hasta</label>
            <input type="date" value={draftAsignacionEnd} onChange={(e) => setDraftAsignacionEnd(e.target.value)} />
          </div>

          <div className="field" style={{ width: 200 }}>
            <label>Días Asigna</label>
            <select value={draftDiasAsignaColor} onChange={(e) => setDraftDiasAsignaColor(e.target.value as "" | "red" | "green")}>
              <option value="">Todos</option>
              <option value="green">Cumple</option>
              <option value="red">No cumple</option>
            </select>
          </div>
          <div className="field" style={{ width: 240 }}>
            <label>Días aprobación Post</label>
            <select
              value={draftDiasAprobacionPostColor}
              onChange={(e) => setDraftDiasAprobacionPostColor(e.target.value as "" | "red" | "green")}
            >
              <option value="">Todos</option>
              <option value="green">Cumple</option>
              <option value="red">No cumple</option>
            </select>
          </div>
          <div className="field" style={{ width: 200 }}>
            <label>Días cierre</label>
            <select value={draftDiasCierreColor} onChange={(e) => setDraftDiasCierreColor(e.target.value as "" | "red" | "green")}>
              <option value="">Todos</option>
              <option value="green">Cumple</option>
              <option value="red">No cumple</option>
            </select>
          </div>
          <div className="field" style={{ width: 240 }}>
            <label>Días gestión total</label>
            <select
              value={draftDiasGestionTotalColor}
              onChange={(e) => setDraftDiasGestionTotalColor(e.target.value as "" | "red" | "green")}
            >
              <option value="">Todos</option>
              <option value="green">Cumple</option>
              <option value="red">No cumple</option>
            </select>
          </div>

          <div className="field" style={{ width: 160 }}>
            <label>&nbsp;</label>
            <button className="btn" type="button" onClick={applyFilters}>
              Buscar
            </button>
          </div>
          <div className="field" style={{ width: 180 }}>
            <label>&nbsp;</label>
            <button className="btn btn-accent" type="button" onClick={clearFilters}>
              Limpiar filtros
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? <div style={{ color: "var(--muted)" }}>Cargando...</div> : null}
        {error ? <div className="error">{error}</div> : null}

        <div className="row" style={{ marginBottom: 10, justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800 }}>Total: {totalCount}</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-sm" type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Anterior
            </button>
            <button
              className="btn btn-sm"
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente
            </button>
          </div>
        </div>

        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th><button className="table-sort" type="button" onClick={() => onSort("orderCode")}>Orden Trabajo</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("nivelTension")}>Nivel de Tensión</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("estado")}>Estado</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("subestado")}>Subestado</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("fechaAsignacion")}>Fecha Asignación</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("fechaGestion")}>Fecha Gestión</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasAsigna")}>Días Asigna</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasAprobacionPost")}>Días aprobación Post</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasCierre")}>Días cierre</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasGestionTotal")}>Días gestión total</button></th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {!hasSearched ? (
                <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--muted)" }}>Presiona Buscar para consultar.</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--muted)" }}>Sin resultados.</td></tr>
              ) : (
                items.map((it) => (
                  <tr key={it.orderCode}>
                    <td>
                      {it.workOrderId ? (
                        <Link to={`/orders/${it.workOrderId}`} state={{ from: `${location.pathname}${location.search}` }}>
                          {it.orderCode}
                        </Link>
                      ) : (
                        it.orderCode
                      )}
                    </td>
                    <td>{fmtVal(it.nivelTension)}</td>
                    <td>{fmtVal(it.estado)}</td>
                    <td>{fmtVal(it.subestado)}</td>
                    <td>{fmtDate(it.fechaAsignacion)}</td>
                    <td title={it.fechaGestionCalculada ? "Calculado con +8 días calendario" : ""}>{fmtDate(it.fechaGestion)}</td>
                    <td style={{ fontWeight: 800, color: it.diasAsignaColor === "red" ? "red" : it.diasAsignaColor === "green" ? "green" : colorOf(it.diasAsigna) }}>
                      {it.diasAsigna ?? "—"}
                    </td>
                    <td style={{ fontWeight: 800, color: it.diasAprobacionPostColor === "red" ? "red" : it.diasAprobacionPostColor === "green" ? "green" : colorOf(it.diasAprobacionPost) }}>
                      {it.diasAprobacionPost ?? "—"}
                    </td>
                    <td style={{ fontWeight: 800, color: it.diasCierreColor === "red" ? "red" : it.diasCierreColor === "green" ? "green" : colorOf(it.diasCierre) }}>
                      {it.diasCierre ?? "—"}
                    </td>
                    <td style={{ fontWeight: 800, color: it.diasGestionTotalColor === "red" ? "red" : it.diasGestionTotalColor === "green" ? "green" : colorOf(it.diasGestionTotal) }}>
                      {it.diasGestionTotal ?? "—"}
                    </td>
                    <td style={{ minWidth: 220 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          className="btn btn-sm"
                          type="button"
                          disabled={!it.workOrderId}
                          onClick={() => {
                            if (!it.workOrderId) return;
                            setSelectedOrder({ id: it.workOrderId, code: it.orderCode });
                            setShowPostprocesoModal(false);
                            setShowNovedadModal(true);
                          }}
                        >
                          Novedades
                        </button>
                        <button
                          className="btn btn-sm"
                          type="button"
                          disabled={!it.workOrderId}
                          onClick={() => {
                            if (!it.workOrderId) return;
                            setSelectedOrder({ id: it.workOrderId, code: it.orderCode });
                            setShowNovedadModal(false);
                            setShowPostprocesoModal(true);
                          }}
                        >
                          Cierre SAIT
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showNovedadModal && selectedOrder && (
        <NovedadModal
          order={selectedOrder}
          onClose={() => {
            setShowNovedadModal(false);
            setShowPostprocesoModal(false);
            setSelectedOrder(null);
          }}
        />
      )}

      {showPostprocesoModal && selectedOrder && (
        <PostprocesoModal
          order={selectedOrder}
          onClose={() => {
            setShowPostprocesoModal(false);
            setShowNovedadModal(false);
            setSelectedOrder(null);
          }}
        />
      )}
    </div>
  );
}

function NovedadModal({ order, onClose }: { order: { id: string; code: string }; onClose: () => void }) {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    fechaInicio: "",
    fechaFin: "",
    descripcion: "",
    detalle: ""
  });
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      alert("Debes adjuntar un soporte para registrar la novedad.");
      return;
    }
    setLoading(true);

    const body = new FormData();
    body.append("fechaInicio", formData.fechaInicio);
    if (formData.fechaFin) body.append("fechaFin", formData.fechaFin);
    body.append("descripcion", formData.descripcion);
    body.append("detalle", formData.detalle);
    body.append("soporte", file);

    try {
      const res = await fetch(`${API_URL}/work-orders/${order.id}/novedades`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body
      });
      if (!res.ok) throw new Error("Error al guardar novedad");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error de conexión";
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content card">
        <h3>Registrar Novedad - Orden {order.code}</h3>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="field">
            <label>Fecha Inicio Novedad *</label>
            <input type="date" value={formData.fechaInicio} onChange={(e) => setFormData((p) => ({ ...p, fechaInicio: e.target.value }))} required />
          </div>
          <div className="field">
            <label>Fecha Fin Novedad (Opcional - Pausará la orden si se deja vacía)</label>
            <input type="date" value={formData.fechaFin} onChange={(e) => setFormData((p) => ({ ...p, fechaFin: e.target.value }))} />
          </div>
          <div className="field">
            <label>Descripción de la novedad *</label>
            <select
              value={formData.descripcion}
              onChange={(e) => setFormData((p) => ({ ...p, descripcion: e.target.value }))}
              required
            >
              <option value="">Selecciona una opción</option>
              {NOVEDAD_OPCIONES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Detalle de la novedad *</label>
            <textarea value={formData.detalle} onChange={(e) => setFormData((p) => ({ ...p, detalle: e.target.value }))} required />
          </div>
          <div className="field">
            <label>Soporte de novedad (Imagen) *</label>
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          </div>
          <div className="actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? "Guardando..." : "Guardar Novedad"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PostprocesoModal({ order, onClose }: { order: { id: string; code: string }; onClose: () => void }) {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [fecha, setFecha] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fecha) {
      alert("Debes seleccionar la fecha de cierre en SAIT.");
      return;
    }
    if (!file) {
      alert("Debes adjuntar el soporte de cierre en SAIT.");
      return;
    }
    setLoading(true);
    const body = new FormData();
    body.append("fecha", fecha);
    body.append("soporte", file);
    try {
      const res = await fetch(`${API_URL}/work-orders/${order.id}/postproceso`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body
      });
      if (!res.ok) throw new Error("Error al registrar cierre SAIT");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error de conexión";
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content card">
        <h3>Registrar Cierre SAIT - Orden {order.code}</h3>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="field">
            <label>Fecha cierre SAIT *</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
          </div>
          <div className="field">
            <label>Soporte cierre SAIT *</label>
            <input type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          </div>
          <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
            <button className="btn" type="button" onClick={onClose} disabled={loading}>Cancelar</button>
            <button className="btn btn-accent" disabled={loading}>{loading ? "Guardando..." : "Guardar"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
