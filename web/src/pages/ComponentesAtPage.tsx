import { useEffect, useMemo, useState } from "react";
import { listComponentesAt, type ComponenteAtRow } from "../api";
import { useAuth } from "../auth";

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function ComponentesAtPage() {
  const { token, user } = useAuth();
  const canView = user?.role === "ADMIN" || !!user?.canCargues;

  const [rows, setRows] = useState<ComponenteAtRow[]>([]);
  const [rotulo, setRotulo] = useState("");
  const [tipo, setTipo] = useState("");
  const [tecnologo, setTecnologo] = useState("");
  const [estado, setEstado] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () => ({
      rotulo: rotulo.trim() || undefined,
      tipo: tipo.trim() || undefined,
      tecnologo: tecnologo.trim() || undefined,
      estado: estado.trim() || undefined
    }),
    [rotulo, tipo, tecnologo, estado]
  );

  async function refresh() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listComponentesAt(token, query);
      setRows(data);
    } catch {
      setError("No se pudo cargar el módulo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token || !canView) return;
    refresh().catch(() => {});
  }, [token, canView, query]);

  if (!canView) return <div className="card">No autorizado.</div>;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Componentes AT</h2>

      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <div className="field" style={{ minWidth: 220 }}>
          <label>Rótulo</label>
          <input value={rotulo} onChange={(e) => setRotulo(e.target.value)} placeholder="Buscar por rótulo..." />
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label>Tipo</label>
          <input value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Filtrar por tipo..." />
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label>Tecnólogo</label>
          <input
            value={tecnologo}
            onChange={(e) => setTecnologo(e.target.value)}
            placeholder="Filtrar por tecnólogo..."
          />
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label>Estado</label>
          <input value={estado} onChange={(e) => setEstado(e.target.value)} placeholder="Filtrar por estado..." />
        </div>
      </div>

      {error ? <div className="message error">{error}</div> : null}
      {loading ? <div style={{ color: "var(--muted)" }}>Cargando...</div> : null}

      {!loading ? (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>F. Asignación ENEL</th>
                <th>Rótulo</th>
                <th>Tipo</th>
                <th>Tecnólogo</th>
                <th>F. Asignación</th>
                <th>F. Instalación</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((r) => (
                  <tr key={r.rotulo}>
                    <td>{fmtDate(r.fechaAsignacionEnel)}</td>
                    <td style={{ fontWeight: 700 }}>{r.rotulo}</td>
                    <td>{r.tipo || "—"}</td>
                    <td>{(r.tecnologo ?? "").trim() || "—"}</td>
                    <td>{fmtDate(r.fechaAsignacion)}</td>
                    <td>{fmtDate(r.fechaInstalacion)}</td>
                    <td>{r.estado || "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} style={{ opacity: 0.75 }}>
                    Sin registros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
