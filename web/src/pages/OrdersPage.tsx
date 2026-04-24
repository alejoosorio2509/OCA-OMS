import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type { WorkOrderListItem, WorkOrderStatus } from "../api";
import { getWorkOrderMetrics, listGestores, listOportunidades, listWorkOrders } from "../api";
import { useAuth } from "../auth";
import "./OrdersPage.css";
import { API_URL } from "../apiUrl";

async function downloadCsv(token: string, path: string, filename: string) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("DOWNLOAD_FAILED");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const statuses: { value: WorkOrderStatus | ""; label: string }[] = [
  { value: "ASIGNADA", label: "Asignada" },
  { value: "EN_EJECUCION", label: "En Ejecución" },
  { value: "ON_HOLD", label: "Pausada" },
  { value: "GESTIONADA", label: "Gestionada" },
  { value: "FACTURADA", label: "Facturada" },
  { value: "CERRADA", label: "Cerrada" },
  { value: "DEVUELTA", label: "Devuelta" },
  { value: "EXCLUDED", label: "Excluida" },
];

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleString();
}

function toKebab(value: string) {
  return value.toLowerCase().replaceAll("_", "-");
}

const statusLabels: Record<WorkOrderStatus, string> = {
  CREATED: "Creada",
  ASSIGNED: "Asignada",
  IN_PROGRESS: "En ejecución",
  ON_HOLD: "En pausa",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
  DRAFT: "Borrador",
  EXCLUDED: "Excluido",
  FACTURADA: "Facturada",
  GESTIONADA: "Gestionada",
  CERRADA: "Cerrada",
  ASIGNADA: "Asignada",
  EN_EJECUCION: "En Ejecución",
  DEVUELTA: "Devuelta",
};

export function OrdersPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { token, user } = useAuth();
  const canOrders = user?.role === "ADMIN" || !!user?.canOrders;
  const [items, setItems] = useState<WorkOrderListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [metrics, setMetrics] = useState({
    total: 0,
    cumplan: 0,
    noCumplan: 0,
    ansPct: 0,
    asignadas: 0,
    enEjecucion: 0,
    pausadas: 0,
    gestionadas: 0,
    facturadas: 0,
    cerradas: 0,
    devueltas: 0
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [gestores, setGestores] = useState<string[]>([]);
  const [oportunidades, setOportunidades] = useState<string[]>([]);

  const initialParams = useMemo(() => {
    const p = new URLSearchParams(location.search);
    if (p.toString()) return p;
    const saved = sessionStorage.getItem("orders_filters");
    if (saved) return new URLSearchParams(saved);
    return p;
  }, [location.search]);
  const initialPage = useMemo(() => {
    const raw = initialParams.get("page");
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [initialParams]);
  const initialStatuses = useMemo(() => {
    const raw = initialParams.get("statuses");
    if (!raw) return [];
    return raw.split(",").filter(Boolean) as WorkOrderStatus[];
  }, [initialParams]);

  const [draftStatuses, setDraftStatuses] = useState<WorkOrderStatus[]>(initialStatuses);
  const [draftSearch, setDraftSearch] = useState(() => initialParams.get("search") || "");
  const [draftGestor, setDraftGestor] = useState(() => initialParams.get("gestor") || "");
  const [draftOportunidad, setDraftOportunidad] = useState(() => initialParams.get("oportunidad") || "");

  const [draftDateField, setDraftDateField] = useState<"assignedAt" | "gestionAt">(
    () => (initialParams.get("dateField") as "assignedAt" | "gestionAt" | null) || "assignedAt"
  );
  const [draftDateStart, setDraftDateStart] = useState(() => initialParams.get("dateStart") || "");
  const [draftDateEnd, setDraftDateEnd] = useState(() => initialParams.get("dateEnd") || "");
  const [draftColorFilter, setDraftColorFilter] = useState<"red" | "green" | "">(
    () => (initialParams.get("color") as "" | "red" | "green" | null) || ""
  );

  type OrdersFilters = {
    statuses: WorkOrderStatus[];
    search: string;
    gestor: string;
    oportunidad: string;
    dateField: "assignedAt" | "gestionAt";
    dateStart: string;
    dateEnd: string;
    color: "" | "red" | "green";
  };

  const [appliedFilters, setAppliedFilters] = useState<OrdersFilters>(() => ({
    statuses: initialStatuses,
    search: initialParams.get("search") || "",
    gestor: initialParams.get("gestor") || "",
    oportunidad: initialParams.get("oportunidad") || "",
    dateField: (initialParams.get("dateField") as "assignedAt" | "gestionAt" | null) || "assignedAt",
    dateStart: initialParams.get("dateStart") || "",
    dateEnd: initialParams.get("dateEnd") || "",
    color: (initialParams.get("color") as "" | "red" | "green" | null) || ""
  }));
  const [page, setPage] = useState<number>(initialPage);
  const pageSize = 50;

  type SortKey =
    | "code"
    | "status"
    | "assignedAt"
    | "fechaTentativaGestion"
    | "gestorNombre"
    | "oportunidad"
    | "ansOportunidad"
    | "baremoAnsCalc"
    | "diasGestion"
    | "diasCumplimiento"
    | "diasDevoluciones"
    | "totalDiasDescuento"
    | "diasEnel"
    | "diasPasados"
    | "cumplimiento";

  const [sortKey, setSortKey] = useState<SortKey>(() => (initialParams.get("sortKey") as SortKey | null) || "fechaTentativaGestion");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => (initialParams.get("sortDir") as "asc" | "desc" | null) || "asc");

  const [selectedOrder, setSelectedOrder] = useState<WorkOrderListItem | null>(null);
  const [showNovedadModal, setShowNovedadModal] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    const next = new URLSearchParams();
    if (appliedFilters.statuses.length > 0) next.set("statuses", appliedFilters.statuses.join(","));
    if (appliedFilters.search.trim()) next.set("search", appliedFilters.search.trim());
    if (appliedFilters.gestor.trim()) next.set("gestor", appliedFilters.gestor.trim());
    if (appliedFilters.oportunidad.trim()) next.set("oportunidad", appliedFilters.oportunidad.trim());
    if (appliedFilters.dateStart) next.set("dateStart", appliedFilters.dateStart);
    if (appliedFilters.dateEnd) next.set("dateEnd", appliedFilters.dateEnd);
    if (appliedFilters.dateStart || appliedFilters.dateEnd) next.set("dateField", appliedFilters.dateField);
    if (appliedFilters.color) next.set("color", appliedFilters.color);
    if (sortKey) next.set("sortKey", sortKey);
    if (sortDir) next.set("sortDir", sortDir);
    if (page > 1) next.set("page", String(page));
    sessionStorage.setItem("orders_filters", next.toString());
    setSearchParams(next, { replace: true });
  }, [appliedFilters, sortKey, sortDir, page, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    Promise.all([listGestores(token), listOportunidades(token)])
      .then(([g, o]) => {
        if (!cancelled) {
          setGestores(g);
          setOportunidades(o);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGestores([]);
          setOportunidades([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const query = useMemo(() => {
    type OrdersQuery = NonNullable<Parameters<typeof listWorkOrders>[1]>;
    const q: OrdersQuery = {
      search: appliedFilters.search.trim() || undefined,
      gestor: appliedFilters.gestor.trim() || undefined,
      oportunidad: appliedFilters.oportunidad.trim() || undefined,
      dateField: (appliedFilters.dateStart || appliedFilters.dateEnd) ? appliedFilters.dateField : undefined,
      dateStart: appliedFilters.dateStart || undefined,
      dateEnd: appliedFilters.dateEnd || undefined,
      colorFilter: appliedFilters.color || undefined,
      page,
      pageSize,
      sortKey,
      sortDir
    };
    if (appliedFilters.statuses.length > 0) q.status = appliedFilters.statuses;
    return q;
  }, [appliedFilters, page, sortKey, sortDir]);

  const draftKey = useMemo(() => {
    return JSON.stringify({
      statuses: draftStatuses,
      search: draftSearch.trim(),
      gestor: draftGestor.trim(),
      oportunidad: draftOportunidad.trim(),
      dateField: (draftDateStart || draftDateEnd) ? draftDateField : "",
      dateStart: draftDateStart,
      dateEnd: draftDateEnd,
      color: draftColorFilter
    });
  }, [draftStatuses, draftSearch, draftGestor, draftOportunidad, draftDateField, draftDateStart, draftDateEnd, draftColorFilter]);

  const appliedKey = useMemo(() => {
    return JSON.stringify({
      statuses: appliedFilters.statuses,
      search: appliedFilters.search.trim(),
      gestor: appliedFilters.gestor.trim(),
      oportunidad: appliedFilters.oportunidad.trim(),
      dateField: (appliedFilters.dateStart || appliedFilters.dateEnd) ? appliedFilters.dateField : "",
      dateStart: appliedFilters.dateStart,
      dateEnd: appliedFilters.dateEnd,
      color: appliedFilters.color
    });
  }, [appliedFilters]);

  const hasPendingFilters = draftKey !== appliedKey;

  const toggleStatus = (s: WorkOrderStatus) => {
    setDraftStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  useEffect(() => {
    let cancelled = false;
    if (!token || !hasSearched) {
      setLoading(false);
      setError(null);
      setItems([]);
      setTotalCount(0);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    listWorkOrders(token, query)
      .then((data) => {
        if (!cancelled) {
          setItems(data.items);
          setTotalCount(data.total);
        }
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo cargar la lista.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token, query, hasSearched]);

  const metricsQuery = useMemo(() => {
    type MetricsQuery = NonNullable<Parameters<typeof getWorkOrderMetrics>[1]>;
    const q: MetricsQuery = {
      search: appliedFilters.search.trim() || undefined,
      gestor: appliedFilters.gestor.trim() || undefined,
      oportunidad: appliedFilters.oportunidad.trim() || undefined,
      dateField: (appliedFilters.dateStart || appliedFilters.dateEnd) ? appliedFilters.dateField : undefined,
      dateStart: appliedFilters.dateStart || undefined,
      dateEnd: appliedFilters.dateEnd || undefined,
      colorFilter: appliedFilters.color || undefined
    };
    if (appliedFilters.statuses.length > 0) q.status = appliedFilters.statuses;
    return q;
  }, [appliedFilters]);

  useEffect(() => {
    let cancelled = false;
    if (!token || !hasSearched) {
      setMetrics({
        total: 0,
        cumplan: 0,
        noCumplan: 0,
        ansPct: 0,
        asignadas: 0,
        enEjecucion: 0,
        pausadas: 0,
        gestionadas: 0,
        facturadas: 0,
        cerradas: 0,
        devueltas: 0
      });
      return () => {
        cancelled = true;
      };
    }
    getWorkOrderMetrics(token, metricsQuery)
      .then((data) => {
        if (cancelled) return;
        setMetrics(data);
      })
      .catch(() => {
        if (cancelled) return;
        setMetrics({
          total: 0,
          cumplan: 0,
          noCumplan: 0,
          ansPct: 0,
          asignadas: 0,
          enEjecucion: 0,
          pausadas: 0,
          gestionadas: 0,
          facturadas: 0,
          cerradas: 0,
          devueltas: 0
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token, metricsQuery, hasSearched]);

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

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return "↕";
    return sortDir === "desc" ? "↓" : "↑";
  };

  const sortIconClass = (key: SortKey) => {
    return `table-sort__icon${sortKey === key ? " table-sort__icon--active" : ""}`;
  };

  const clearFilters = () => {
    setDraftStatuses([]);
    setDraftSearch("");
    setDraftGestor("");
    setDraftOportunidad("");
    setDraftDateField("assignedAt");
    setDraftDateStart("");
    setDraftDateEnd("");
    setDraftColorFilter("");
    setAppliedFilters({
      statuses: [],
      search: "",
      gestor: "",
      oportunidad: "",
      dateField: "assignedAt",
      dateStart: "",
      dateEnd: "",
      color: ""
    });
    setSortKey("fechaTentativaGestion");
    setSortDir("asc");
    setPage(1);
    sessionStorage.removeItem("orders_filters");
    setHasSearched(false);
    setItems([]);
    setTotalCount(0);
  };

  const applyFilters = () => {
    setAppliedFilters({
      statuses: draftStatuses,
      search: draftSearch,
      gestor: draftGestor,
      oportunidad: draftOportunidad,
      dateField: draftDateField,
      dateStart: draftDateStart,
      dateEnd: draftDateEnd,
      color: draftColorFilter
    });
    setPage(1);
    setHasSearched(true);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const exportQuery = useMemo(() => {
    const qs = new URLSearchParams();
    appliedFilters.statuses.forEach((s) => qs.append("status", s));
    if (appliedFilters.search.trim()) qs.set("search", appliedFilters.search.trim());
    if (appliedFilters.gestor.trim()) qs.set("gestor", appliedFilters.gestor.trim());
    if (appliedFilters.oportunidad.trim()) qs.set("oportunidad", appliedFilters.oportunidad.trim());
    if (appliedFilters.dateStart || appliedFilters.dateEnd) qs.set("dateField", appliedFilters.dateField);
    if (appliedFilters.dateStart) qs.set("dateStart", appliedFilters.dateStart);
    if (appliedFilters.dateEnd) qs.set("dateEnd", appliedFilters.dateEnd);
    if (appliedFilters.color) qs.set("colorFilter", appliedFilters.color);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }, [appliedFilters]);

  const handleExport = async () => {
    if (!token) return;
    const filename = `ordenes_${new Date().toISOString().slice(0, 10)}.csv`;
    await downloadCsv(token, `/exports/orders.csv${exportQuery}`, filename);
  };

  if (!canOrders) return <div className="card">No autorizado.</div>;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card">
        <div className="row" style={{ alignItems: "end", gap: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Buscar</label>
            <input value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)} placeholder="Código..." />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Gestor</label>
            <select style={{ width: "100%" }} value={draftGestor} onChange={(e) => setDraftGestor(e.target.value)}>
              <option value="">Todos</option>
              {draftGestor && !gestores.includes(draftGestor) && <option value={draftGestor}>{draftGestor}</option>}
              {gestores.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Oportunidad</label>
            <select style={{ width: "100%" }} value={draftOportunidad} onChange={(e) => setDraftOportunidad(e.target.value)}>
              <option value="">Todas</option>
              {draftOportunidad && !oportunidades.includes(draftOportunidad) && <option value={draftOportunidad}>{draftOportunidad}</option>}
              {oportunidades.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="field" style={{ width: 160 }}>
            <label>Tipo Fecha</label>
            <select value={draftDateField} onChange={(e) => setDraftDateField(e.target.value as "assignedAt" | "gestionAt")}>
              <option value="assignedAt">Asignación</option>
              <option value="gestionAt">Gestión</option>
            </select>
          </div>
          <div className="field" style={{ width: 130 }}>
            <label>Inicio</label>
            <input type="date" value={draftDateStart} onChange={(e) => setDraftDateStart(e.target.value)} />
          </div>
          <div className="field" style={{ width: 130 }}>
            <label>Fin</label>
            <input type="date" value={draftDateEnd} onChange={(e) => setDraftDateEnd(e.target.value)} />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>ANS</label>
            <select value={draftColorFilter} onChange={(e) => setDraftColorFilter(e.target.value as "" | "red" | "green")}>
              <option value="">Todos</option>
              <option value="green">Cumple</option>
              <option value="red">No cumple</option>
            </select>
          </div>
          <div className="field" style={{ width: 160 }}>
            <label>&nbsp;</label>
            <button className="btn" onClick={applyFilters} type="button" disabled={!hasPendingFilters && hasSearched}>
              Buscar
            </button>
          </div>
          <div className="field" style={{ width: 180 }}>
            <label>&nbsp;</label>
            <button className="btn btn-accent" onClick={clearFilters} type="button">Limpiar filtros</button>
          </div>
          <div className="field" style={{ width: 160 }}>
            <label>&nbsp;</label>
            <button className="btn" onClick={handleExport} type="button">Exportar</button>
          </div>
        </div>

        <div className="row" style={{ marginTop: 14, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <label style={{ fontWeight: "bold", fontSize: "0.85rem" }}>Estados:</label>
              {draftStatuses.length > 0 && (
                <button onClick={clearFilters} className="btn-link" style={{ fontSize: "0.75rem" }}>Limpiar</button>
              )}
              {hasPendingFilters ? (
                <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Cambios sin aplicar</span>
              ) : null}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {statuses.map(s => (
                <label 
                  key={s.value} 
                  className={`badge status-${toKebab(s.value as string)}`}
                  style={{ 
                    cursor: "pointer", 
                    opacity: draftStatuses.includes(s.value as WorkOrderStatus) ? 1 : 0.4,
                    border: draftStatuses.includes(s.value as WorkOrderStatus) ? "2px solid #fff" : "2px solid transparent",
                    transition: "all 0.2s"
                  }}
                  onClick={() => toggleStatus(s.value as WorkOrderStatus)}
                >
                  {s.label}
                </label>
              ))}
            </div>
          </div>
          <div style={{ textAlign: "right", paddingLeft: 20 }}>
            <div style={{ fontSize: "1.1rem", fontWeight: "bold" }}>Total: {totalCount}</div>
            <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>Página {page} / {totalPages}</div>
            <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn btn-sm" type="button" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Anterior</button>
              <button className="btn btn-sm" type="button" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Siguiente</button>
            </div>
          </div>
        </div>
      </div>

      <div className="orders-dashboard">
        <div className="metric-card">
          <div className="metric-icon metric-icon--blue">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-6v-6H10v6H4a1 1 0 0 1-1-1V10.5z" />
            </svg>
          </div>
          <div className="metric-body">
            <div className="metric-label">Total Órdenes</div>
            <div className="metric-value">{metrics.total}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon--green">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
            </svg>
          </div>
          <div className="metric-body">
            <div className="metric-label">Cumplen</div>
            <div className="metric-value">{metrics.cumplan}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon--red">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2zm1 14h-2v-2h2v2zm0-4h-2V6h2v6z" />
            </svg>
          </div>
          <div className="metric-body">
            <div className="metric-label">No cumplen</div>
            <div className="metric-value">{metrics.noCumplan}</div>
          </div>
        </div>

        <div className="metric-card metric-card--highlight">
          <div className="metric-icon metric-icon--dark">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2zm1 10.6V7h-2v7l5 3 .9-1.5-3.9-2.3z" />
            </svg>
          </div>
          <div className="metric-body">
            <div className="metric-label">ANS</div>
            <div className="metric-value">{metrics.ansPct}%</div>
            <div className="metric-sub">Cumplimiento</div>
          </div>
          <div className="metric-bar" aria-hidden="true">
            <div className="metric-bar__fill" style={{ width: `${metrics.ansPct}%` }} />
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon--teal">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2a7 7 0 0 0-7 7c0 2.8 1.6 5.2 4 6.3V20a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4.7c2.4-1.1 4-3.5 4-6.3a7 7 0 0 0-7-7zm2.5 12.1-1.5.7V19h-2v-4.2l-1.5-.7A5 5 0 1 1 14.5 14.1z" />
            </svg>
          </div>
          <div className="metric-body">
            <div className="metric-label">Asignadas</div>
            <div className="metric-value">{metrics.asignadas}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon--teal">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2zm1 5h-2v6l5 3 .9-1.5-3.9-2.3V7z" />
            </svg>
          </div>
          <div className="metric-body">
            <div className="metric-label">En ejecución</div>
            <div className="metric-value">{metrics.enEjecucion}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon--amber">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2a7 7 0 0 0-4 12.7V20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-5.3A7 7 0 0 0 12 2zm2 18h-4v-1h4v1zm0-3h-4v-2.6l-.4-.2A5 5 0 1 1 14.4 14.2l-.4.2V17z" />
            </svg>
          </div>
          <div className="metric-body">
            <div className="metric-label">Pausadas</div>
            <div className="metric-value">{metrics.pausadas}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon--blue">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 21H7v-8h2v8zm4 0h-2V3h2v18zm4 0h-2v-12h2v12z" />
            </svg>
          </div>
          <div className="metric-body">
            <div className="metric-label">Gestionadas</div>
            <div className="metric-value">{metrics.gestionadas}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon--blue">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 18c-1.7 0-3-1.3-3-3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v9c0 1.7-1.3 3-3 3H7zm10-2c.6 0 1-.4 1-1V6c0-.6-.4-1-1-1H7c-.6 0-1 .4-1 1v9c0 .6.4 1 1 1h10zm-6 6H9v-2h2v2zm4 0h-2v-2h2v2z" />
            </svg>
          </div>
          <div className="metric-body">
            <div className="metric-label">Facturadas</div>
            <div className="metric-value">{metrics.facturadas}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon--blue">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 3H5a2 2 0 0 0-2 2v16l4-2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H6.5L5 17.7V5h14v12z" />
            </svg>
          </div>
          <div className="metric-body">
            <div className="metric-label">Devueltas</div>
            <div className="metric-value">{metrics.devueltas}</div>
          </div>
        </div>
      </div>

      {error && <div className="error card">{error}</div>}
      {loading ? <div className="card">Cargando...</div> : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th><button className="table-sort" type="button" onClick={() => onSort("code")}>OT <span className={sortIconClass("code")}>{sortIndicator("code")}</span></button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("status")}>Estado <span className={sortIconClass("status")}>{sortIndicator("status")}</span></button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("assignedAt")}>Asignación <span className={sortIconClass("assignedAt")}>{sortIndicator("assignedAt")}</span></button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("fechaTentativaGestion")}>Fecha tentativa/Gestión <span className={sortIconClass("fechaTentativaGestion")}>{sortIndicator("fechaTentativaGestion")}</span></button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("gestorNombre")}>Gestor <span className={sortIconClass("gestorNombre")}>{sortIndicator("gestorNombre")}</span></button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("oportunidad")}>Oportunidad <span className={sortIconClass("oportunidad")}>{sortIndicator("oportunidad")}</span></button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("ansOportunidad")}>ANS <span className={sortIconClass("ansOportunidad")}>{sortIndicator("ansOportunidad")}</span></button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasGestion")}>Días Gestión <span className={sortIconClass("diasGestion")}>{sortIndicator("diasGestion")}</span></button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("baremoAnsCalc")}>Baremo <span className={sortIconClass("baremoAnsCalc")}>{sortIndicator("baremoAnsCalc")}</span></button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasEnel")}>R. Incrementos <span className={sortIconClass("diasEnel")}>{sortIndicator("diasEnel")}</span></button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasCumplimiento")}>D. Novedades <span className={sortIconClass("diasCumplimiento")}>{sortIndicator("diasCumplimiento")}</span></button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasDevoluciones")}>D. Devoluciones <span className={sortIconClass("diasDevoluciones")}>{sortIndicator("diasDevoluciones")}</span></button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("totalDiasDescuento")}>D. Descuento <span className={sortIconClass("totalDiasDescuento")}>{sortIndicator("totalDiasDescuento")}</span></button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasPasados")}>D. Pasados <span className={sortIconClass("diasPasados")}>{sortIndicator("diasPasados")}</span></button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("cumplimiento")}>Cumple <span className={sortIconClass("cumplimiento")}>{sortIndicator("cumplimiento")}</span></button></th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={16} style={{ textAlign: "center", color: "var(--muted)" }}>Sin resultados.</td></tr>
              ) : items.map(it => (
                <tr key={it.id}>
                  <td><Link to={`/orders/${it.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`}>{it.code}</Link></td>
                  <td><span className={`badge status-${toKebab(it.status)}`}>{statusLabels[it.status] || it.status}</span></td>
                  <td>{fmtDate(it.assignedAt)}</td>
                  <td>{fmtDate(it.fechaTentativaGestion ?? null)}</td>
                  <td title={it.gestorCc || ""}>{it.gestorNombre || "—"}</td>
                  <td>{it.oportunidad || "—"}</td>
                  <td>{it.ansOportunidad || "—"}</td>
                  <td title={it.gestionAt ? `Calculado con Fecha Gestión: ${fmtDate(it.gestionAt)}` : "Calculado con hoy"}>{it.diasGestion ?? "—"}</td>
                  <td>{typeof it.baremoAnsCalc === "number" ? Math.round(it.baremoAnsCalc).toString() : "—"}</td>
                  <td>{it.diasEnel || 0}</td>
                  <td>{it.diasCumplimiento ?? 0}</td>
                  <td>{it.diasDevoluciones ?? 0}</td>
                  <td>{it.totalDiasDescuento || 0}</td>
                  <td style={{ 
                    color: it.cumplimiento === "No cumple" ? "red" : it.cumplimiento === "Cumple" ? "green" : "var(--muted)",
                    fontWeight: "bold"
                  }}>{it.diasPasados ?? "—"}</td>
                  <td style={{ fontWeight: "bold", color: it.cumplimiento === "No cumple" ? "red" : it.cumplimiento === "Cumple" ? "green" : "var(--muted)" }}>
                    {it.cumplimiento ?? "—"}
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => { setSelectedOrder(it); setShowNovedadModal(true); }}>Novedades</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNovedadModal && selectedOrder && (
        <NovedadModal 
          order={selectedOrder} 
          onClose={() => { setShowNovedadModal(false); setSelectedOrder(null); window.location.reload(); }} 
        />
      )}
    </div>
  );
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
"Sobre dimensión",
];

function NovedadModal({ order, onClose }: { order: WorkOrderListItem, onClose: () => void }) {
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
    } catch {
      alert("No se pudo guardar la novedad");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content card">
        <h3>Registrar Novedad - Orden {order.code}</h3>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Fecha Inicio Novedad *</label>
            <input 
              type="date" 
              required 
              value={formData.fechaInicio} 
              onChange={e => setFormData({...formData, fechaInicio: e.target.value})} 
            />
          </div>
          <div className="field">
            <label>Fecha Fin Novedad (Opcional - Pausará la orden si se deja vacía)</label>
            <input 
              type="date" 
              value={formData.fechaFin} 
              onChange={e => setFormData({...formData, fechaFin: e.target.value})} 
            />
          </div>
          <div className="field">
            <label>Descripción de la novedad *</label>
            <select 
              required 
              value={formData.descripcion} 
              onChange={e => setFormData({...formData, descripcion: e.target.value})} 
            >
              <option value="">Seleccione una opción...</option>
              {NOVEDAD_OPCIONES.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Detalle de la novedad *</label>
            <textarea 
              required 
              value={formData.detalle} 
              onChange={e => setFormData({...formData, detalle: e.target.value})} 
            />
          </div>
          <div className="field">
            <label>Soporte de novedad (Imagen) *</label>
            <input 
              type="file" 
              accept="image/*" 
              required
              onChange={e => setFile(e.target.files?.[0] || null)} 
            />
          </div>
          <div className="actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? "Guardando..." : "Guardar Novedad"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
