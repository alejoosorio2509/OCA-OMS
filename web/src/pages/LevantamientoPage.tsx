import { useEffect, useMemo, useState } from "react";
import type { LevantamientoListItem } from "../api";
import {
  getLevantamientoMetrics,
  listLevantamientoEntregas,
  listLevantamientoNivelesTension,
  listLevantamientoTiposOt,
  listLevantamientos
} from "../api";
import { useAuth } from "../auth";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { API_URL } from "../apiUrl";

async function downloadCsv(token: string, path: string, filename: string) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await readApiError(res));
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

async function readApiError(res: Response) {
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/json")) {
    const data = (await res.json().catch(() => null)) as null | { error?: unknown; details?: unknown };
    const e = typeof data?.error === "string" ? data.error : "";
    const d = typeof data?.details === "string" ? data.details : "";
    const core = [e, d].filter(Boolean).join(": ").trim();
    return core || `Error HTTP ${res.status}`;
  }
  const text = (await res.text().catch(() => "")).trim();
  return text || `Error HTTP ${res.status}`;
}

const DASH_BLUE = "#0B3356";
const DASH_RED = "#DE473C";

const CUADRILLA_LABELS: Record<string, string> = {
  CUA_1: "RAFAEL DURAN",
  CUA_2: "OSCAR CASTELBLANCO",
  CUA_3: "DANNY BRICEÑO",
  CUA_4: "JIMMY CRUZ",
  CUA_10: "CUA_10",
  SUP: "WILMER MARTINEZ"
};

const NOVEDAD_OPCIONES = [
  "STOP WORK POR LLUVIAS EN EL SECTOR",
  "STOP WORK POR DERRUMBES EN LA VIA",
  "CLIENTE NO PERMITE ACCESO",
  "STOP WORK POR INCIDENTES DE ORDEN PUBLICO",
  "RUTA ALTERNA POR BLOQUEOS",
  "DESEMBARCO",
  "INCIDENTES MECANICOS",
  "TANQUEO GASOLINA",
  "INSPECCIÓN ENEL",
  "AUTORIZACIÓN INGRESO",
  "DIFICULTAD ACCESO",
  "STOP WORK POR RIESGO ELÉCTRICO",
  "STOP WORK POR RIESGO BIOLOGICO",
  "STOP WORK ENEL"
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
  const [metrics, setMetrics] = useState<null | {
    total: number;
    asignacion: number;
    primerElemento: number;
    entregaPostproceso: number;
    aprobacionPostproceso: number;
    gestion: number;
    gestionCerradas: number;
    gestionAbiertas: number;
    aprobacionCumple: number;
    aprobacionNoCumple: number;
    aprobacionPct: number;
  }>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [hasSearched, setHasSearched] = useState(() => initialParams.toString().length > 0);
  const [selectedOrder, setSelectedOrder] = useState<{ id: string; code: string } | null>(null);
  const [showNovedadModal, setShowNovedadModal] = useState(false);
  const [showPostprocesoModal, setShowPostprocesoModal] = useState(false);

  const [draftSearch, setDraftSearch] = useState(() => initialParams.get("search") || "");
  const [draftNivelTension, setDraftNivelTension] = useState(() => initialParams.get("nivelTension") || "");
  const [draftCuadrilla, setDraftCuadrilla] = useState(() => initialParams.get("cuadrilla") || "");
  const [draftTipoOt, setDraftTipoOt] = useState(() => initialParams.get("tipoOt") || "");
  const [draftEntrega, setDraftEntrega] = useState(() => initialParams.get("entrega") || "");
  const [draftEtapa, setDraftEtapa] = useState(() => initialParams.get("etapa") || "");
  const [draftFechaFiltro, setDraftFechaFiltro] = useState<"PRIMER_ELEMENTO" | "ASIGNACION">(
    () => (initialParams.get("fechaFiltro") as "PRIMER_ELEMENTO" | "ASIGNACION" | null) || "PRIMER_ELEMENTO"
  );
  const [draftAsignacionStart, setDraftAsignacionStart] = useState(() => initialParams.get("asignacionStart") || "");
  const [draftAsignacionEnd, setDraftAsignacionEnd] = useState(() => initialParams.get("asignacionEnd") || "");
  const [nivelesTension, setNivelesTension] = useState<string[]>([]);
  const [tiposOt, setTiposOt] = useState<string[]>([]);
  const [entregas, setEntregas] = useState<string[]>([]);

  const [draftDiasAsignaColor, setDraftDiasAsignaColor] = useState<"" | "red" | "yellow" | "green">(
    () => (initialParams.get("diasAsignaColor") as "" | "red" | "yellow" | "green" | null) || ""
  );
  const [draftDiasAprobacionPostColor, setDraftDiasAprobacionPostColor] = useState<"" | "red" | "yellow" | "green">(
    () => (initialParams.get("diasAprobacionPostColor") as "" | "red" | "yellow" | "green" | null) || ""
  );
  const [draftDiasCierreColor, setDraftDiasCierreColor] = useState<"" | "red" | "yellow" | "green">(
    () => (initialParams.get("diasCierreColor") as "" | "red" | "yellow" | "green" | null) || ""
  );
  const [draftDiasGestionTotalColor, setDraftDiasGestionTotalColor] = useState<"" | "red" | "yellow" | "green">(
    () => (initialParams.get("diasGestionTotalColor") as "" | "red" | "yellow" | "green" | null) || ""
  );

  type Filters = {
    search: string;
    nivelTension: string;
    cuadrilla: string;
    tipoOt: string;
    entrega: string;
    etapa: "" | "ASIGNACION" | "PRIMER_ELEMENTO" | "ENTREGA_POSTPROCESO" | "APROBACION_POSTPROCESO" | "GESTION";
    fechaFiltro: "PRIMER_ELEMENTO" | "ASIGNACION";
    asignacionStart: string;
    asignacionEnd: string;
    diasAsignaColor: "" | "red" | "yellow" | "green";
    diasAprobacionPostColor: "" | "red" | "yellow" | "green";
    diasCierreColor: "" | "red" | "yellow" | "green";
    diasGestionTotalColor: "" | "red" | "yellow" | "green";
  };

  const [applied, setApplied] = useState<Filters>(() => ({
    search: initialParams.get("search") || "",
    nivelTension: initialParams.get("nivelTension") || "",
    cuadrilla: initialParams.get("cuadrilla") || "",
    tipoOt: initialParams.get("tipoOt") || "",
    entrega: initialParams.get("entrega") || "",
    etapa: (initialParams.get("etapa") as Filters["etapa"] | null) || "",
    fechaFiltro: (initialParams.get("fechaFiltro") as Filters["fechaFiltro"] | null) || "PRIMER_ELEMENTO",
    asignacionStart: initialParams.get("asignacionStart") || "",
    asignacionEnd: initialParams.get("asignacionEnd") || "",
    diasAsignaColor: (initialParams.get("diasAsignaColor") as "" | "red" | "yellow" | "green" | null) || "",
    diasAprobacionPostColor: (initialParams.get("diasAprobacionPostColor") as "" | "red" | "yellow" | "green" | null) || "",
    diasCierreColor: (initialParams.get("diasCierreColor") as "" | "red" | "yellow" | "green" | null) || "",
    diasGestionTotalColor: (initialParams.get("diasGestionTotalColor") as "" | "red" | "yellow" | "green" | null) || ""
  }));

  const [page, setPage] = useState(initialPage);
  const pageSize = 50;

  type SortKey =
    | "fechaAsignacion"
    | "fechaPrimerElemento"
    | "fechaGestion"
    | "orderCode"
    | "nivelTension"
    | "estado"
    | "subestado"
    | "diasAsigna"
    | "diasAprobacionPost"
    | "diasCierre"
    | "diasGestionTotal";

  const [sortKey, setSortKey] = useState<SortKey>(() => (initialParams.get("sortKey") as SortKey | null) || "fechaPrimerElemento");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => (initialParams.get("sortDir") as "asc" | "desc" | null) || "desc");

  const applyFilters = () => {
    setApplied({
      search: draftSearch,
      nivelTension: draftNivelTension,
      cuadrilla: draftCuadrilla,
      tipoOt: draftTipoOt,
      entrega: draftEntrega,
      etapa: (draftEtapa as Filters["etapa"]) || "",
      fechaFiltro: draftFechaFiltro,
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

  const toggleEtapa = (value: Exclude<Filters["etapa"], "">) => {
    const next = applied.etapa === value ? "" : value;
    setDraftEtapa(next);
    setApplied((prev) => ({ ...prev, etapa: next }));
    setHasSearched(true);
    setPage(1);
  };

  const clearFilters = () => {
    setDraftSearch("");
    setDraftNivelTension("");
    setDraftCuadrilla("");
    setDraftTipoOt("");
    setDraftEntrega("");
    setDraftEtapa("");
    setDraftFechaFiltro("PRIMER_ELEMENTO");
    setDraftAsignacionStart("");
    setDraftAsignacionEnd("");
    setDraftDiasAsignaColor("");
    setDraftDiasAprobacionPostColor("");
    setDraftDiasCierreColor("");
    setDraftDiasGestionTotalColor("");
    setApplied({
      search: "",
      nivelTension: "",
      cuadrilla: "",
      tipoOt: "",
      entrega: "",
      etapa: "",
      fechaFiltro: "PRIMER_ELEMENTO",
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
    if (applied.cuadrilla.trim()) next.set("cuadrilla", applied.cuadrilla.trim());
    if (applied.tipoOt.trim()) next.set("tipoOt", applied.tipoOt.trim());
    if (applied.entrega.trim()) next.set("entrega", applied.entrega.trim());
    if (applied.etapa) next.set("etapa", applied.etapa);
    if (applied.fechaFiltro) next.set("fechaFiltro", applied.fechaFiltro);
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
      cuadrilla: applied.cuadrilla.trim() || undefined,
      tipoOt: applied.tipoOt.trim() || undefined,
      entrega: applied.entrega.trim() || undefined,
      etapa: applied.etapa || undefined,
      fechaFiltro: applied.fechaFiltro || undefined,
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
    Promise.all([
      listLevantamientoNivelesTension(token).catch(() => [] as string[]),
      listLevantamientoTiposOt(token).catch(() => [] as string[]),
      listLevantamientoEntregas(token).catch(() => [] as string[])
    ]).then(([niveles, tipos, ents]) => {
      if (cancelled) return;
      setNivelesTension(niveles);
      setTiposOt(tipos);
      setEntregas(ents);
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
      setMetrics(null);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    getLevantamientoMetrics(token, {
      search: query.search,
      nivelTension: query.nivelTension,
      cuadrilla: query.cuadrilla,
      tipoOt: query.tipoOt,
      entrega: query.entrega,
      fechaFiltro: query.fechaFiltro,
      asignacionStart: query.asignacionStart,
      asignacionEnd: query.asignacionEnd
    })
      .then((m) => {
        if (!cancelled) setMetrics(m);
      })
      .catch(() => {
        if (!cancelled) setMetrics(null);
      });
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
  }, [token, query, hasSearched, refreshTick]);

  const exportCsv = async () => {
    if (!token) return;
    const p = new URLSearchParams();
    if (applied.search.trim()) p.set("search", applied.search.trim());
    if (applied.nivelTension.trim()) p.set("nivelTension", applied.nivelTension.trim());
    if (applied.cuadrilla.trim()) p.set("cuadrilla", applied.cuadrilla.trim());
    if (applied.tipoOt.trim()) p.set("tipoOt", applied.tipoOt.trim());
    if (applied.entrega.trim()) p.set("entrega", applied.entrega.trim());
    if (applied.etapa) p.set("etapa", applied.etapa);
    if (applied.fechaFiltro) p.set("fechaFiltro", applied.fechaFiltro);
    if (applied.asignacionStart) p.set("asignacionStart", applied.asignacionStart);
    if (applied.asignacionEnd) p.set("asignacionEnd", applied.asignacionEnd);
    if (applied.diasAsignaColor) p.set("diasAsignaColor", applied.diasAsignaColor);
    if (applied.diasAprobacionPostColor) p.set("diasAprobacionPostColor", applied.diasAprobacionPostColor);
    if (applied.diasCierreColor) p.set("diasCierreColor", applied.diasCierreColor);
    if (applied.diasGestionTotalColor) p.set("diasGestionTotalColor", applied.diasGestionTotalColor);
    const qs = p.toString();
    const filename = `levantamientos_${new Date().toISOString().slice(0, 10)}.csv`;
    await downloadCsv(token, `/exports/levantamientos.csv${qs ? `?${qs}` : ""}`, filename);
  };

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
      {metrics ? (
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <div
              style={{
                padding: 12,
                border: `1px solid ${DASH_BLUE}`,
                borderRadius: 8,
                background: "white",
                display: "flex",
                alignItems: "center",
                gap: 10
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: DASH_BLUE,
                  display: "grid",
                  placeItems: "center",
                  flex: "0 0 auto"
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 20, height: 20, fill: "white" }}>
                  <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-6v-6H10v6H4a1 1 0 0 1-1-1V10.5z" />
                </svg>
              </div>
              <div>
                <div style={{ color: DASH_BLUE, fontSize: 12 }}>Total</div>
                <div style={{ fontWeight: 900, fontSize: 22, color: DASH_BLUE }}>{metrics.total}</div>
              </div>
            </div>
            <button
              type="button"
              className="btn-link"
              onClick={() => toggleEtapa("ASIGNACION")}
              style={{
                padding: 12,
                border: `1px solid ${applied.etapa === "ASIGNACION" ? DASH_RED : DASH_BLUE}`,
                borderRadius: 8,
                textAlign: "left",
                background: applied.etapa === "ASIGNACION" ? `${DASH_RED}10` : "white",
                display: "flex",
                alignItems: "center",
                gap: 10
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: applied.etapa === "ASIGNACION" ? DASH_RED : DASH_BLUE,
                  display: "grid",
                  placeItems: "center",
                  flex: "0 0 auto"
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 20, height: 20, fill: "white" }}>
                  <path d="M12 2a7 7 0 0 0-7 7c0 2.8 1.6 5.2 4 6.3V20a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4.7c2.4-1.1 4-3.5 4-6.3a7 7 0 0 0-7-7zm2.5 12.1-1.5.7V19h-2v-4.2l-1.5-.7A5 5 0 1 1 14.5 14.1z" />
                </svg>
              </div>
              <div>
                <div style={{ color: DASH_BLUE, fontSize: 12 }}>Asignación</div>
                <div style={{ fontWeight: 900, fontSize: 22, color: DASH_BLUE }}>{metrics.asignacion}</div>
              </div>
            </button>
            <button
              type="button"
              className="btn-link"
              onClick={() => toggleEtapa("PRIMER_ELEMENTO")}
              style={{
                padding: 12,
                border: `1px solid ${applied.etapa === "PRIMER_ELEMENTO" ? DASH_RED : DASH_BLUE}`,
                borderRadius: 8,
                textAlign: "left",
                background: applied.etapa === "PRIMER_ELEMENTO" ? `${DASH_RED}10` : "white",
                display: "flex",
                alignItems: "center",
                gap: 10
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: applied.etapa === "PRIMER_ELEMENTO" ? DASH_RED : DASH_BLUE,
                  display: "grid",
                  placeItems: "center",
                  flex: "0 0 auto"
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 20, height: 20, fill: "white" }}>
                  <path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2zm1 5h-2v6l5 3 .9-1.5-3.9-2.3V7z" />
                </svg>
              </div>
              <div>
                <div style={{ color: DASH_BLUE, fontSize: 12 }}>Primer elemento</div>
                <div style={{ fontWeight: 900, fontSize: 22, color: DASH_BLUE }}>{metrics.primerElemento}</div>
              </div>
            </button>
            <button
              type="button"
              className="btn-link"
              onClick={() => toggleEtapa("ENTREGA_POSTPROCESO")}
              style={{
                padding: 12,
                border: `1px solid ${applied.etapa === "ENTREGA_POSTPROCESO" ? DASH_RED : DASH_BLUE}`,
                borderRadius: 8,
                textAlign: "left",
                background: applied.etapa === "ENTREGA_POSTPROCESO" ? `${DASH_RED}10` : "white",
                display: "flex",
                alignItems: "center",
                gap: 10
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: applied.etapa === "ENTREGA_POSTPROCESO" ? DASH_RED : DASH_BLUE,
                  display: "grid",
                  placeItems: "center",
                  flex: "0 0 auto"
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 20, height: 20, fill: "white" }}>
                  <path d="M7 18c-1.7 0-3-1.3-3-3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v9c0 1.7-1.3 3-3 3H7zm10-2c.6 0 1-.4 1-1V6c0-.6-.4-1-1-1H7c-.6 0-1 .4-1 1v9c0 .6.4 1 1 1h10zm-6 6H9v-2h2v2zm4 0h-2v-2h2v2z" />
                </svg>
              </div>
              <div>
                <div style={{ color: DASH_BLUE, fontSize: 12 }}>Entrega postproceso</div>
                <div style={{ fontWeight: 900, fontSize: 22, color: DASH_BLUE }}>{metrics.entregaPostproceso}</div>
              </div>
            </button>
            <button
              type="button"
              className="btn-link"
              onClick={() => toggleEtapa("APROBACION_POSTPROCESO")}
              style={{
                padding: 12,
                border: `1px solid ${applied.etapa === "APROBACION_POSTPROCESO" ? DASH_RED : DASH_BLUE}`,
                borderRadius: 8,
                textAlign: "left",
                background: applied.etapa === "APROBACION_POSTPROCESO" ? `${DASH_RED}10` : "white",
                display: "flex",
                alignItems: "flex-start",
                gap: 10
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: applied.etapa === "APROBACION_POSTPROCESO" ? DASH_RED : DASH_BLUE,
                  display: "grid",
                  placeItems: "center",
                  flex: "0 0 auto",
                  marginTop: 2
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 20, height: 20, fill: "white" }}>
                  <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: DASH_BLUE, fontSize: 12 }}>Aprobación postproceso</div>
                <div style={{ fontWeight: 900, fontSize: 22, color: DASH_BLUE }}>{metrics.aprobacionPostproceso}</div>
                <div style={{ marginTop: 6, fontSize: 12, color: DASH_BLUE }}>3 días máx</div>
                <div style={{ height: 8, background: `${DASH_BLUE}22`, borderRadius: 10, overflow: "hidden", marginTop: 6 }}>
                  <div style={{ height: "100%", width: `${metrics.aprobacionPct}%`, background: DASH_RED }} />
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: DASH_BLUE }}>
                  Cumplen: {metrics.aprobacionCumple} · No cumplen: {metrics.aprobacionNoCumple} · {metrics.aprobacionPct}%
                </div>
              </div>
            </button>
            <button
              type="button"
              className="btn-link"
              onClick={() => toggleEtapa("GESTION")}
              style={{
                padding: 12,
                border: `1px solid ${applied.etapa === "GESTION" ? DASH_RED : DASH_BLUE}`,
                borderRadius: 8,
                textAlign: "left",
                background: applied.etapa === "GESTION" ? `${DASH_RED}10` : "white",
                display: "flex",
                alignItems: "center",
                gap: 10
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: applied.etapa === "GESTION" ? DASH_RED : DASH_BLUE,
                  display: "grid",
                  placeItems: "center",
                  flex: "0 0 auto"
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 20, height: 20, fill: "white" }}>
                  <path d="M9 21H7v-8h2v8zm4 0h-2V3h2v18zm4 0h-2v-12h2v12z" />
                </svg>
              </div>
              <div>
                <div style={{ color: DASH_BLUE, fontSize: 12 }}>Gestión</div>
                <div style={{ fontWeight: 900, fontSize: 22, color: DASH_BLUE }}>{metrics.gestion}</div>
              </div>
            </button>
            <div
              style={{
                padding: 12,
                border: `1px solid ${DASH_BLUE}`,
                borderRadius: 8,
                background: "white",
                display: "flex",
                alignItems: "flex-start",
                gap: 10
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: DASH_BLUE,
                  display: "grid",
                  placeItems: "center",
                  flex: "0 0 auto",
                  marginTop: 2
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 20, height: 20, fill: "white" }}>
                  <path d="M4 4h16v2H4V4zm0 7h16v2H4v-2zm0 7h16v2H4v-2z" />
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: DASH_BLUE, fontSize: 12 }}>Gestión por entrega</div>
                <div style={{ marginTop: 6, fontSize: 12, color: DASH_BLUE }}>
                  Cerradas: <span style={{ fontWeight: 900 }}>{metrics.gestionCerradas}</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: DASH_BLUE }}>
                  Abiertas: <span style={{ fontWeight: 900 }}>{metrics.gestionAbiertas}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Cuadrilla</label>
            <select value={draftCuadrilla} onChange={(e) => setDraftCuadrilla(e.target.value)} style={{ width: "100%" }}>
              <option value="">Todas</option>
              {Object.entries(CUADRILLA_LABELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Tipo OT</label>
            <select value={draftTipoOt} onChange={(e) => setDraftTipoOt(e.target.value)} style={{ width: "100%" }}>
              <option value="">Todos</option>
              {tiposOt.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Entrega</label>
            <select value={draftEntrega} onChange={(e) => setDraftEntrega(e.target.value)} style={{ width: "100%" }}>
              <option value="">Todas</option>
              {entregas.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ width: 220 }}>
            <label>Filtrar fecha por</label>
            <select
              value={draftFechaFiltro}
              onChange={(e) => setDraftFechaFiltro(e.target.value as "PRIMER_ELEMENTO" | "ASIGNACION")}
              style={{ width: "100%" }}
            >
              <option value="PRIMER_ELEMENTO">Fecha Primer Elemento</option>
              <option value="ASIGNACION">Fecha Asignación</option>
            </select>
          </div>
          <div className="field" style={{ width: 180 }}>
            <label>{draftFechaFiltro === "ASIGNACION" ? "Asignación desde" : "Primer elemento desde"}</label>
            <input type="date" value={draftAsignacionStart} onChange={(e) => setDraftAsignacionStart(e.target.value)} />
          </div>
          <div className="field" style={{ width: 180 }}>
            <label>{draftFechaFiltro === "ASIGNACION" ? "Asignación hasta" : "Primer elemento hasta"}</label>
            <input type="date" value={draftAsignacionEnd} onChange={(e) => setDraftAsignacionEnd(e.target.value)} />
          </div>

          <div className="field" style={{ width: 200 }}>
            <label>Días Asigna</label>
            <select value={draftDiasAsignaColor} onChange={(e) => setDraftDiasAsignaColor(e.target.value as "" | "red" | "yellow" | "green")}>
              <option value="">Todos</option>
              <option value="green">Cumple</option>
              <option value="yellow">Por vencer</option>
              <option value="red">No cumple</option>
            </select>
          </div>
          <div className="field" style={{ width: 240 }}>
            <label>Días aprobación Post</label>
            <select
              value={draftDiasAprobacionPostColor}
              onChange={(e) => setDraftDiasAprobacionPostColor(e.target.value as "" | "red" | "yellow" | "green")}
            >
              <option value="">Todos</option>
              <option value="green">Cumple</option>
              <option value="yellow">Por vencer</option>
              <option value="red">No cumple</option>
            </select>
          </div>
          <div className="field" style={{ width: 200 }}>
            <label>Días cierre</label>
            <select value={draftDiasCierreColor} onChange={(e) => setDraftDiasCierreColor(e.target.value as "" | "red" | "yellow" | "green")}>
              <option value="">Todos</option>
              <option value="green">Cumple</option>
              <option value="yellow">Por vencer</option>
              <option value="red">No cumple</option>
            </select>
          </div>
          <div className="field" style={{ width: 240 }}>
            <label>Días gestión total</label>
            <select
              value={draftDiasGestionTotalColor}
              onChange={(e) => setDraftDiasGestionTotalColor(e.target.value as "" | "red" | "yellow" | "green")}
            >
              <option value="">Todos</option>
              <option value="green">Cumple</option>
              <option value="yellow">Por vencer</option>
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
            <button className="btn btn-sm" type="button" disabled={!token || !hasSearched} onClick={exportCsv}>
              Exportar CSV
            </button>
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
                <th>Tipo Entrega</th>
                <th><button className="table-sort" type="button" onClick={() => onSort("nivelTension")}>Nivel de Tensión</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("estado")}>Estado</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("subestado")}>Subestado</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("fechaPrimerElemento")}>Fecha Primer Elemento</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("fechaGestion")}>Fecha Gestión</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasAsigna")}>Días Asigna</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasAprobacionPost")}>Días aprobación Post</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasCierre")}>Días cierre</button></th>
                <th><button className="table-sort" type="button" onClick={() => onSort("diasGestionTotal")}>Días gestión total</button></th>
                <th>R. Incrementos</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {!hasSearched ? (
                <tr><td colSpan={13} style={{ textAlign: "center", color: "var(--muted)" }}>Presiona Buscar para consultar.</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={13} style={{ textAlign: "center", color: "var(--muted)" }}>Sin resultados.</td></tr>
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
                    <td>{fmtVal(it.entregaKeyLevantamiento)}</td>
                    <td>{fmtVal(it.nivelTension)}</td>
                    <td>{fmtVal(it.estado)}</td>
                    <td>{fmtVal(it.subestado)}</td>
                    <td>{fmtDate(it.fechaPrimerElemento ?? null)}</td>
                    <td title={it.fechaGestionCalculada ? "Calculado con +8 días calendario" : ""}>{fmtDate(it.fechaGestion ?? null)}</td>
                    <td style={{ fontWeight: 800, color: it.diasAsignaColor === "red" ? "red" : it.diasAsignaColor === "yellow" ? "#d39e00" : it.diasAsignaColor === "green" ? "green" : colorOf(it.diasAsigna) }}>
                      {it.diasAsigna ?? "—"}
                    </td>
                    <td style={{ fontWeight: 800, color: it.diasAprobacionPostColor === "red" ? "red" : it.diasAprobacionPostColor === "yellow" ? "#d39e00" : it.diasAprobacionPostColor === "green" ? "green" : colorOf(it.diasAprobacionPost) }}>
                      {it.diasAprobacionPost ?? "—"}
                    </td>
                    <td style={{ fontWeight: 800, color: it.diasCierreColor === "red" ? "red" : it.diasCierreColor === "yellow" ? "#d39e00" : it.diasCierreColor === "green" ? "green" : colorOf(it.diasCierre) }}>
                      {it.diasCierre ?? "—"}
                    </td>
                    <td style={{ fontWeight: 800, color: it.diasGestionTotalColor === "red" ? "red" : it.diasGestionTotalColor === "yellow" ? "#d39e00" : it.diasGestionTotalColor === "green" ? "green" : colorOf(it.diasGestionTotal) }}>
                      {it.diasGestionTotal ?? "—"}
                    </td>
                    <td>{it.diasEnel || 0}</td>
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
          onSaved={() => setRefreshTick((v) => v + 1)}
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
          onSaved={() => setRefreshTick((v) => v + 1)}
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

function NovedadModal({ order, onSaved, onClose }: { order: { id: string; code: string }; onSaved: () => void; onClose: () => void }) {
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
      onSaved();
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

function PostprocesoModal({ order, onSaved, onClose }: { order: { id: string; code: string }; onSaved: () => void; onClose: () => void }) {
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
      onSaved();
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
