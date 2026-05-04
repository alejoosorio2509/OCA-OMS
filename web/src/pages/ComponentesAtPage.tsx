import { useEffect, useMemo, useState } from "react";
import { getComponentesAtOptions, listComponentesAt, type ComponenteAtRow } from "../api";
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
  const [asignacionDesde, setAsignacionDesde] = useState("");
  const [asignacionHasta, setAsignacionHasta] = useState("");
  const [instalacionDesde, setInstalacionDesde] = useState("");
  const [instalacionHasta, setInstalacionHasta] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tipos, setTipos] = useState<string[]>([]);
  const [tecnologos, setTecnologos] = useState<string[]>([]);
  const [estados, setEstados] = useState<string[]>([]);

  const [appliedQuery, setAppliedQuery] = useState<{
    rotulo?: string;
    tipo?: string;
    tecnologo?: string;
    estado?: string;
    asignacionStart?: string;
    asignacionEnd?: string;
    instalacionStart?: string;
    instalacionEnd?: string;
  }>({});

  const queryDraft = useMemo(
    () => ({
      rotulo: rotulo.trim() || undefined,
      tipo: tipo.trim() || undefined,
      tecnologo: tecnologo.trim() || undefined,
      estado: estado.trim() || undefined,
      asignacionStart: asignacionDesde.trim() || undefined,
      asignacionEnd: asignacionHasta.trim() || undefined,
      instalacionStart: instalacionDesde.trim() || undefined,
      instalacionEnd: instalacionHasta.trim() || undefined
    }),
    [rotulo, tipo, tecnologo, estado, asignacionDesde, asignacionHasta, instalacionDesde, instalacionHasta]
  );

  async function refresh(nextQuery: {
    rotulo?: string;
    tipo?: string;
    tecnologo?: string;
    estado?: string;
  }) {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listComponentesAt(token, nextQuery);
      setRows(data);
    } catch {
      setError("No se pudo cargar el módulo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token || !canView) return;
    refresh(appliedQuery).catch(() => {});
  }, [token, canView, appliedQuery]);

  useEffect(() => {
    if (!token || !canView) return;
    getComponentesAtOptions(token)
      .then((data) => {
        setTipos(Array.isArray(data.tipos) ? data.tipos : []);
        setTecnologos(Array.isArray(data.tecnologos) ? data.tecnologos : []);
        setEstados(Array.isArray(data.estados) ? data.estados : []);
      })
      .catch(() => {
        return;
      });
  }, [token, canView]);

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
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {tipos.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label>Tecnólogo</label>
          <select value={tecnologo} onChange={(e) => setTecnologo(e.target.value)}>
            <option value="">Todos</option>
            {tecnologos.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label>Estado</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos</option>
            {estados.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label>F. Asignación desde</label>
          <input type="date" value={asignacionDesde} onChange={(e) => setAsignacionDesde(e.target.value)} />
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label>F. Asignación hasta</label>
          <input type="date" value={asignacionHasta} onChange={(e) => setAsignacionHasta(e.target.value)} />
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label>F. Instalación desde</label>
          <input type="date" value={instalacionDesde} onChange={(e) => setInstalacionDesde(e.target.value)} />
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label>F. Instalación hasta</label>
          <input type="date" value={instalacionHasta} onChange={(e) => setInstalacionHasta(e.target.value)} />
        </div>
        <div className="field" style={{ minWidth: 140, alignSelf: "flex-end" }}>
          <button
            className="btn"
            onClick={() => {
              setAppliedQuery(queryDraft);
            }}
            disabled={loading}
            type="button"
          >
            Buscar
          </button>
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
