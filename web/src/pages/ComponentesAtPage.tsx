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
  const [codigo, setCodigo] = useState("");
  const [tipo, setTipo] = useState("");
  const [tecnologo, setTecnologo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () => ({
      codigo: codigo.trim() || undefined,
      tipo: tipo.trim() || undefined,
      tecnologo: tecnologo.trim() || undefined
    }),
    [codigo, tipo, tecnologo]
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
          <label>Código</label>
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Buscar por código..." />
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
      </div>

      {error ? <div className="message error">{error}</div> : null}
      {loading ? <div style={{ color: "var(--muted)" }}>Cargando...</div> : null}

      {!loading ? (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Tipo</th>
                <th>Tecnólogo</th>
                <th>F. Asigna ENEL</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((r) => (
                  <tr key={r.codigo}>
                    <td style={{ fontWeight: 700 }}>{r.codigo}</td>
                    <td>{r.tipo || "—"}</td>
                    <td>{(r.tecnologo ?? "").trim() || "—"}</td>
                    <td>{fmtDate(r.fechaAsignaEnel)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} style={{ opacity: 0.75 }}>
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
