import { useEffect, useMemo, useState } from "react";
import type { LevantamientoListItem } from "../api";
import { listLevantamientoNivelesTension, listLevantamientos } from "../api";
import { useAuth } from "../auth";

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

export function LevantamientoPage() {
  const { token, user } = useAuth();
  const canOrders = user?.role === "ADMIN" || !!user?.canOrders;

  const [items, setItems] = useState<LevantamientoListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hasSearched, setHasSearched] = useState(false);

  const [draftSearch, setDraftSearch] = useState("");
  const [draftNivelTension, setDraftNivelTension] = useState("");
  const [nivelesTension, setNivelesTension] = useState<string[]>([]);

  const [draftDiasAsignaColor, setDraftDiasAsignaColor] = useState<"" | "red" | "green">("");
  const [draftDiasAprobacionPostColor, setDraftDiasAprobacionPostColor] = useState<"" | "red" | "green">("");
  const [draftDiasCierreColor, setDraftDiasCierreColor] = useState<"" | "red" | "green">("");
  const [draftDiasGestionTotalColor, setDraftDiasGestionTotalColor] = useState<"" | "red" | "green">("");

  type Filters = {
    search: string;
    nivelTension: string;
    diasAsignaColor: "" | "red" | "green";
    diasAprobacionPostColor: "" | "red" | "green";
    diasCierreColor: "" | "red" | "green";
    diasGestionTotalColor: "" | "red" | "green";
  };

  const [applied, setApplied] = useState<Filters>({
    search: "",
    nivelTension: "",
    diasAsignaColor: "",
    diasAprobacionPostColor: "",
    diasCierreColor: "",
    diasGestionTotalColor: ""
  });

  const [page, setPage] = useState(1);
  const pageSize = 50;

  type SortKey =
    | "fechaAsignacion"
    | "fechaGestion"
    | "orderCode"
    | "nivelTension"
    | "diasAsigna"
    | "diasAprobacionPost"
    | "diasCierre"
    | "diasGestionTotal";

  const [sortKey, setSortKey] = useState<SortKey>("fechaAsignacion");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const applyFilters = () => {
    setApplied({
      search: draftSearch,
      nivelTension: draftNivelTension,
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
    setDraftDiasAsignaColor("");
    setDraftDiasAprobacionPostColor("");
    setDraftDiasCierreColor("");
    setDraftDiasGestionTotalColor("");
    setApplied({
      search: "",
      nivelTension: "",
      diasAsignaColor: "",
      diasAprobacionPostColor: "",
      diasCierreColor: "",
      diasGestionTotalColor: ""
    });
    setHasSearched(false);
    setItems([]);
    setTotalCount(0);
    setPage(1);
  };

  const query = useMemo(() => {
    return {
      search: applied.search.trim() || undefined,
      nivelTension: applied.nivelTension.trim() || undefined,
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
                <th>Estado</th>
                <th>Subestado</th>
                <th><button className="table-sort" type="button" onClick={() => onSort("fechaAsignacion")}>Fecha Asignación</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("fechaGestion")}>Fecha Gestión</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasAsigna")}>Días Asigna</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasAprobacionPost")}>Días aprobación Post</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasCierre")}>Días cierre</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasGestionTotal")}>Días gestión total</button></th>
              </tr>
            </thead>
            <tbody>
              {!hasSearched ? (
                <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--muted)" }}>Presiona Buscar para consultar.</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--muted)" }}>Sin resultados.</td></tr>
              ) : (
                items.map((it) => (
                  <tr key={it.orderCode}>
                    <td>{it.orderCode}</td>
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
