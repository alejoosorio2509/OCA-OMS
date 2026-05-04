import { useEffect, useMemo, useState } from "react";
import { asignarCompAt, listAsignacionCompAt, listTecnologos, type AsignacionCompAtRow, type TecnologoOption } from "../api";
import { useAuth } from "../auth";

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function AsignacionCompAtPage() {
  const { token, user } = useAuth();
  const canAsignacion = user?.role === "ADMIN" || !!user?.canAsignacionCompAt;

  const [rows, setRows] = useState<AsignacionCompAtRow[]>([]);
  const [tecnologos, setTecnologos] = useState<TecnologoOption[]>([]);
  const [estado, setEstado] = useState("");
  const [tipo, setTipo] = useState("");
  const [tecnologo, setTecnologo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [assigningRotulo, setAssigningRotulo] = useState<string | null>(null);
  const [selectedTecnologoId, setSelectedTecnologoId] = useState("");
  const [savingAssign, setSavingAssign] = useState(false);

  const query = useMemo(
    () => ({
      estado: estado.trim() || undefined,
      tipo: tipo.trim() || undefined,
      tecnologo: tecnologo.trim() || undefined
    }),
    [estado, tipo, tecnologo]
  );

  async function refresh() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [data, techs] = await Promise.all([listAsignacionCompAt(token, query), listTecnologos(token)]);
      setRows(data);
      setTecnologos(techs);
    } catch {
      setError("No se pudo cargar el módulo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token || !canAsignacion) return;
    refresh().catch(() => {});
  }, [token, canAsignacion, query]);

  if (!canAsignacion) return <div className="card">No autorizado.</div>;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Asignación comp. AT</h2>

      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <div className="field" style={{ minWidth: 220 }}>
          <label>Estado</label>
          <input value={estado} onChange={(e) => setEstado(e.target.value)} placeholder="Ej: DISPONIBLE / ASIGNADO" />
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label>Tipo</label>
          <input value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Filtrar por tipo..." />
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label>Tecnólogo</label>
          <input value={tecnologo} onChange={(e) => setTecnologo(e.target.value)} placeholder="Filtrar por tecnólogo..." />
        </div>
      </div>

      {error ? <div className="message error">{error}</div> : null}
      {loading ? <div style={{ color: "var(--muted)" }}>Cargando...</div> : null}

      {!loading ? (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Rótulo</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Asignado a</th>
                <th>F. Asignación ENEL</th>
                <th>F. Asignación</th>
                <th>F. Instalación</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((r) => {
                  const isDisponible = (r.estado ?? "").trim().toUpperCase() === "DISPONIBLE";
                  return (
                    <tr key={r.rotulo}>
                      <td style={{ fontWeight: 700 }}>{r.rotulo}</td>
                      <td>{r.tipo || "—"}</td>
                      <td>{r.estado || "—"}</td>
                      <td>{r.asignadoA}</td>
                      <td>{fmtDate(r.fechaAsignacionEnel)}</td>
                      <td>{fmtDate(r.fechaAsignacion)}</td>
                      <td>{fmtDate(r.fechaInstalacion)}</td>
                      <td>
                        {isDisponible ? (
                          <button
                            className="btn"
                            onClick={() => {
                              setAssigningRotulo(r.rotulo);
                              setSelectedTecnologoId("");
                            }}
                          >
                            Asignación
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} style={{ opacity: 0.75 }}>
                    Sin registros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {assigningRotulo ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h3 style={{ marginTop: 0 }}>Asignar rótulo {assigningRotulo}</h3>
            <div className="field">
              <label>Tecnólogo</label>
              <select value={selectedTecnologoId} onChange={(e) => setSelectedTecnologoId(e.target.value)}>
                <option value="">Selecciona...</option>
                {tecnologos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.email})
                  </option>
                ))}
              </select>
            </div>
            <div className="actions" style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setAssigningRotulo(null)} disabled={savingAssign}>
                Cancelar
              </button>
              <button
                className="btn"
                disabled={!selectedTecnologoId || savingAssign}
                onClick={async () => {
                  if (!token) return;
                  setSavingAssign(true);
                  setError(null);
                  try {
                    await asignarCompAt(token, assigningRotulo, selectedTecnologoId);
                    setAssigningRotulo(null);
                    await refresh();
                  } catch {
                    setError("No se pudo asignar.");
                  } finally {
                    setSavingAssign(false);
                  }
                }}
              >
                {savingAssign ? "Asignando..." : "Asignar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
