import { useEffect, useMemo, useState } from "react";
import {
  asignarComponenteAt,
  getComponentesAtOptions,
  listComponentesAt,
  listTecnologosComponentesAt,
  registrarInstalacionComponenteAt,
  type ComponenteAtRow,
  type TecnologoOption
} from "../api";
import { useAuth } from "../auth";

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function readApiError(e: unknown) {
  const anyErr = e as unknown as { data?: unknown; message?: unknown };
  const data = anyErr?.data as unknown as { error?: unknown; details?: unknown };
  const err = typeof data?.error === "string" ? data.error : "";
  const details = typeof data?.details === "string" ? data.details : "";
  const msg = [err, details].filter(Boolean).join(": ").trim();
  if (msg) return msg;
  return typeof anyErr?.message === "string" && anyErr.message ? anyErr.message : "Error";
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
  const [tecnologoOptions, setTecnologoOptions] = useState<TecnologoOption[]>([]);

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

  async function refresh(nextQuery: typeof appliedQuery) {
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

  useEffect(() => {
    if (!token || !canView) return;
    listTecnologosComponentesAt(token)
      .then((data) => setTecnologoOptions(Array.isArray(data) ? data : []))
      .catch(() => setTecnologoOptions([]));
  }, [token, canView]);

  const [showAsignarModal, setShowAsignarModal] = useState(false);
  const [showInstalacionModal, setShowInstalacionModal] = useState(false);
  const [selected, setSelected] = useState<ComponenteAtRow | null>(null);

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
                <th></th>
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
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => {
                          setSelected(r);
                          setShowAsignarModal(true);
                        }}
                      >
                        Asignar
                      </button>{" "}
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => {
                          setSelected(r);
                          setShowInstalacionModal(true);
                        }}
                      >
                        Instalación
                      </button>
                    </td>
                  </tr>
                ))
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

      {showAsignarModal && selected ? (
        <AsignarModal
          rotulo={selected.rotulo}
          token={token}
          options={tecnologoOptions}
          onClose={() => {
            setShowAsignarModal(false);
            setSelected(null);
          }}
          onSaved={() => {
            setShowAsignarModal(false);
            setSelected(null);
            refresh(appliedQuery).catch(() => {});
          }}
        />
      ) : null}

      {showInstalacionModal && selected ? (
        <InstalacionModal
          rotulo={selected.rotulo}
          token={token}
          onClose={() => {
            setShowInstalacionModal(false);
            setSelected(null);
          }}
          onSaved={() => {
            setShowInstalacionModal(false);
            setSelected(null);
            refresh(appliedQuery).catch(() => {});
          }}
        />
      ) : null}
    </div>
  );
}

function AsignarModal(props: {
  rotulo: string;
  token: string | null;
  options: TecnologoOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [tecnologo, setTecnologo] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!props.token) return;
    setLoading(true);
    try {
      await asignarComponenteAt(props.token, props.rotulo, { tecnologo });
      props.onSaved();
    } catch (err) {
      alert(readApiError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content card">
        <h3>Asignar - {props.rotulo}</h3>
        <form onSubmit={submit}>
          <div className="field">
            <label>Tecnólogo *</label>
            <select value={tecnologo} onChange={(e) => setTecnologo(e.target.value)} required>
              <option value="">Seleccione...</option>
              {props.options.map((t) => (
                <option key={t.id} value={t.email}>
                  {t.name} ({t.email})
                </option>
              ))}
            </select>
          </div>
          <div className="actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn btn-secondary" onClick={props.onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InstalacionModal(props: { rotulo: string; token: string | null; onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    orden: "",
    pf: "",
    direccion: "",
    municipio: "",
    coordenadaX: "",
    coordenadaY: ""
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!props.token) return;
    setLoading(true);
    try {
      await registrarInstalacionComponenteAt(props.token, props.rotulo, {
        orden: form.orden,
        pf: form.pf,
        direccion: form.direccion,
        municipio: form.municipio,
        coordenadaX: form.coordenadaX,
        coordenadaY: form.coordenadaY
      });
      props.onSaved();
    } catch (err) {
      alert(readApiError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content card">
        <h3>Instalación - {props.rotulo}</h3>
        <form onSubmit={submit}>
          <div className="field">
            <label>ORDEN *</label>
            <input required value={form.orden} onChange={(e) => setForm({ ...form, orden: e.target.value })} />
          </div>
          <div className="field">
            <label>PF *</label>
            <input required value={form.pf} onChange={(e) => setForm({ ...form, pf: e.target.value })} />
          </div>
          <div className="field">
            <label>DIRECCIÓN *</label>
            <input required value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
          </div>
          <div className="field">
            <label>MUNICIPIO *</label>
            <input required value={form.municipio} onChange={(e) => setForm({ ...form, municipio: e.target.value })} />
          </div>
          <div className="field">
            <label>COORDENADA X *</label>
            <input required value={form.coordenadaX} onChange={(e) => setForm({ ...form, coordenadaX: e.target.value })} />
          </div>
          <div className="field">
            <label>COORDENADA Y *</label>
            <input required value={form.coordenadaY} onChange={(e) => setForm({ ...form, coordenadaY: e.target.value })} />
          </div>
          <div className="actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn btn-secondary" onClick={props.onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
