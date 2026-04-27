import { useMemo, useState } from "react";
import { useAuth } from "../auth";
import { API_URL } from "../apiUrl";

function buildQuery(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

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

export function ExportesPage() {
  const { token, user } = useAuth();
  const canExportes = user?.role === "ADMIN" || !!user?.canExportes;

  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [loading, setLoading] = useState<"" | "general" | "devoluciones" | "historial" | "levantamiento">("");
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () =>
      buildQuery({
        dateStart: dateStart || undefined,
        dateEnd: dateEnd || undefined
      }),
    [dateStart, dateEnd]
  );

  if (!canExportes) return <div className="card">No autorizado.</div>;

  const handle = async (kind: "general" | "devoluciones" | "historial" | "levantamiento") => {
    if (!token) return;
    setError(null);
    setLoading(kind);
    try {
      const range = dateStart || dateEnd ? `${dateStart || "inicio"}-${dateEnd || "fin"}` : "todas";
      if (kind === "general") {
        await downloadCsv(token, `/exports/general.csv${query}`, `reporte_general_${range}.csv`);
      }
      if (kind === "devoluciones") {
        await downloadCsv(token, `/exports/devoluciones.csv${query}`, `reporte_devoluciones_${range}.csv`);
      }
      if (kind === "historial") {
        await downloadCsv(token, `/exports/historial.csv${query}`, `reporte_historial_${range}.csv`);
      }
      if (kind === "levantamiento") {
        await downloadCsv(token, `/exports/levantamientos.csv${query}`, `levantamiento_${range}.csv`);
      }
    } catch {
      setError("No se pudo descargar el reporte.");
    } finally {
      setLoading("");
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Exportes</h2>
        <div className="row" style={{ gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <div className="field" style={{ width: 180 }}>
            <label>Asignación (inicio)</label>
            <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
          </div>
          <div className="field" style={{ width: 180 }}>
            <label>Asignación (fin)</label>
            <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
          </div>
        </div>
      </div>

      {error && <div className="card error">{error}</div>}

      <div className="card">
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => handle("general")} disabled={!!loading}>
            {loading === "general" ? "Generando..." : "Exportar reporte general"}
          </button>
          <button className="btn" onClick={() => handle("devoluciones")} disabled={!!loading}>
            {loading === "devoluciones" ? "Generando..." : "Exportar reporte de devoluciones"}
          </button>
          <button className="btn" onClick={() => handle("historial")} disabled={!!loading}>
            {loading === "historial" ? "Generando..." : "Exportar historial de órdenes"}
          </button>
          <button className="btn" onClick={() => handle("levantamiento")} disabled={!!loading}>
            {loading === "levantamiento" ? "Generando..." : "Exportar levantamiento"}
          </button>
        </div>
      </div>
    </div>
  );
}
