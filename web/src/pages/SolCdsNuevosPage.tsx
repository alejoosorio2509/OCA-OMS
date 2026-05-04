import { useEffect, useMemo, useState } from "react";
import { createSolCdsNuevo, getSolCdsNuevoOptions, type SolCdsNuevoCreateInput, type SolCdsNuevoOptions } from "../api";
import { useAuth } from "../auth";

export function SolCdsNuevosPage() {
  const { token, user } = useAuth();
  const canSolCdsNuevos = user?.role === "ADMIN" || !!user?.canSolCdsNuevos;

  const [options, setOptions] = useState<SolCdsNuevoOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successRegistro, setSuccessRegistro] = useState<string | null>(null);

  const [form, setForm] = useState<SolCdsNuevoCreateInput>(() => ({
    ot: "",
    incremento: "",
    tipoOrden: "Inconsistencia",
    cd: "",
    subestacionSbItm: "",
    codCircuitStm: "",
    circuitoStm: "",
    marca: "",
    modelo: "",
    punFisico: "",
    direccion: "",
    terDesc: "",
    orgDesc: "",
    usoTrafo: "ENEL",
    propiedad: "ENEL",
    tipRedTransformador: "Subterranea",
    fase: "Trifasico",
    coordenadasX: "",
    coordenadasY: ""
  }));

  useEffect(() => {
    if (!token || !canSolCdsNuevos) return;
    setLoading(true);
    setError(null);
    getSolCdsNuevoOptions(token)
      .then((data) => {
        setOptions(data);
      })
      .catch(() => {
        setError("No se pudieron cargar las opciones.");
      })
      .finally(() => setLoading(false));
  }, [token, canSolCdsNuevos]);

  const tipoOrdenOptions = useMemo(() => options?.tipoOrden ?? [], [options]);

  if (!canSolCdsNuevos) return <div className="card">No autorizado.</div>;

  const renderDatalist = (id: string, opts: string[]) => (
    <datalist id={id}>
      {opts.map((v) => (
        <option key={v} value={v} />
      ))}
    </datalist>
  );

  const normalizeFromOptions = (value: string, opts: string[]) => {
    const raw = value.trim();
    if (!raw) return raw;
    const lower = raw.toLowerCase();
    const match = opts.find((o) => o.toLowerCase() === lower);
    return match ?? raw;
  };

  const validateCatalogValue = (label: string, value: string, opts: string[], issues: string[]) => {
    const raw = value.trim();
    if (!raw) {
      issues.push(label);
      return raw;
    }
    const normalized = normalizeFromOptions(raw, opts);
    if (!opts.includes(normalized)) issues.push(label);
    return normalized;
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setSuccessRegistro(null);
    setSaving(true);
    try {
      const issues: string[] = [];
      const normalized: SolCdsNuevoCreateInput = options
        ? {
            ...form,
            subestacionSbItm: validateCatalogValue("SUBESTACION_SB:ITM", form.subestacionSbItm, options.subestaciones, issues),
            codCircuitStm: validateCatalogValue("COD_CIRCUIT_STM", form.codCircuitStm, options.codCircuitStm, issues),
            circuitoStm: validateCatalogValue("CIRCUITO_STM", form.circuitoStm, options.circuitoStm, issues),
            marca: validateCatalogValue("MARCA", form.marca, options.marcas, issues),
            modelo: validateCatalogValue("MODELO", form.modelo, options.modelos, issues),
            terDesc: validateCatalogValue("TER_DESC", form.terDesc, options.terDesc, issues),
            orgDesc: validateCatalogValue("ORG_DESC", form.orgDesc, options.orgDesc, issues)
          }
        : form;

      if (issues.length) {
        setError(`Valores inválidos en: ${issues.join(", ")}`);
        setSaving(false);
        return;
      }

      const created = await createSolCdsNuevo(token, normalized);
      setSuccessRegistro(created.registro);
      setForm((prev) => ({
        ...prev,
        ot: "",
        incremento: "",
        cd: "",
        punFisico: "",
        direccion: "",
        coordenadasX: "",
        coordenadasY: ""
      }));
    } catch {
      setError("No se pudo crear la solicitud. Revisa que todos los campos estén completos.");
    } finally {
      setSaving(false);
    }
  }

  const disabled = loading || saving || !options;

  return (
    <div className="card">
      <h2>Sol. CDS Nuevos</h2>
      <p style={{ marginTop: 0 }}>Al crear la solicitud, el sistema asigna un número de registro que inicia con CDN.</p>

      {loading ? <div>Cargando opciones...</div> : null}
      {error ? <div className="message error">{error}</div> : null}
      {successRegistro ? <div className="message success">Solicitud creada. Registro: {successRegistro}</div> : null}

      <form onSubmit={onSubmit} className="upload-form" style={{ marginTop: 12 }}>
        <div className="field">
          <label>OT</label>
          <input value={form.ot} onChange={(e) => setForm({ ...form, ot: e.target.value })} disabled={disabled} />
        </div>
        <div className="field">
          <label>INCREMENTO</label>
          <input value={form.incremento} onChange={(e) => setForm({ ...form, incremento: e.target.value })} disabled={disabled} />
        </div>
        <div className="field">
          <label>TIPO DE ORDEN</label>
          <select
            value={form.tipoOrden}
            onChange={(e) => setForm({ ...form, tipoOrden: e.target.value as SolCdsNuevoCreateInput["tipoOrden"] })}
            disabled={disabled}
          >
            {tipoOrdenOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>CD</label>
          <input value={form.cd} onChange={(e) => setForm({ ...form, cd: e.target.value })} disabled={disabled} />
        </div>

        <div className="field">
          <label>SUBESTACION_SB:ITM</label>
          <input
            value={form.subestacionSbItm}
            onChange={(e) => setForm({ ...form, subestacionSbItm: e.target.value })}
            onBlur={() => {
              if (!options) return;
              const next = normalizeFromOptions(form.subestacionSbItm, options.subestaciones);
              if (next !== form.subestacionSbItm) setForm({ ...form, subestacionSbItm: next });
            }}
            list="dl-subestacionSbItm"
            disabled={disabled}
          />
          {renderDatalist("dl-subestacionSbItm", options?.subestaciones ?? [])}
        </div>
        <div className="field">
          <label>COD_CIRCUIT_STM</label>
          <input
            value={form.codCircuitStm}
            onChange={(e) => setForm({ ...form, codCircuitStm: e.target.value })}
            onBlur={() => {
              if (!options) return;
              const next = normalizeFromOptions(form.codCircuitStm, options.codCircuitStm);
              if (next !== form.codCircuitStm) setForm({ ...form, codCircuitStm: next });
            }}
            list="dl-codCircuitStm"
            disabled={disabled}
          />
          {renderDatalist("dl-codCircuitStm", options?.codCircuitStm ?? [])}
        </div>
        <div className="field">
          <label>CIRCUITO_STM</label>
          <input
            value={form.circuitoStm}
            onChange={(e) => setForm({ ...form, circuitoStm: e.target.value })}
            onBlur={() => {
              if (!options) return;
              const next = normalizeFromOptions(form.circuitoStm, options.circuitoStm);
              if (next !== form.circuitoStm) setForm({ ...form, circuitoStm: next });
            }}
            list="dl-circuitoStm"
            disabled={disabled}
          />
          {renderDatalist("dl-circuitoStm", options?.circuitoStm ?? [])}
        </div>

        <div className="field">
          <label>MARCA</label>
          <input
            value={form.marca}
            onChange={(e) => setForm({ ...form, marca: e.target.value })}
            onBlur={() => {
              if (!options) return;
              const next = normalizeFromOptions(form.marca, options.marcas);
              if (next !== form.marca) setForm({ ...form, marca: next });
            }}
            list="dl-marca"
            disabled={disabled}
          />
          {renderDatalist("dl-marca", options?.marcas ?? [])}
        </div>
        <div className="field">
          <label>MODELO</label>
          <input
            value={form.modelo}
            onChange={(e) => setForm({ ...form, modelo: e.target.value })}
            onBlur={() => {
              if (!options) return;
              const next = normalizeFromOptions(form.modelo, options.modelos);
              if (next !== form.modelo) setForm({ ...form, modelo: next });
            }}
            list="dl-modelo"
            disabled={disabled}
          />
          {renderDatalist("dl-modelo", options?.modelos ?? [])}
        </div>

        <div className="field">
          <label>PUN_FISICO</label>
          <input value={form.punFisico} onChange={(e) => setForm({ ...form, punFisico: e.target.value })} disabled={disabled} />
        </div>
        <div className="field">
          <label>DIRECCION</label>
          <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} disabled={disabled} />
        </div>

        <div className="field">
          <label>TER_DESC</label>
          <input
            value={form.terDesc}
            onChange={(e) => setForm({ ...form, terDesc: e.target.value })}
            onBlur={() => {
              if (!options) return;
              const next = normalizeFromOptions(form.terDesc, options.terDesc);
              if (next !== form.terDesc) setForm({ ...form, terDesc: next });
            }}
            list="dl-terDesc"
            disabled={disabled}
          />
          {renderDatalist("dl-terDesc", options?.terDesc ?? [])}
        </div>
        <div className="field">
          <label>ORG_DESC</label>
          <input
            value={form.orgDesc}
            onChange={(e) => setForm({ ...form, orgDesc: e.target.value })}
            onBlur={() => {
              if (!options) return;
              const next = normalizeFromOptions(form.orgDesc, options.orgDesc);
              if (next !== form.orgDesc) setForm({ ...form, orgDesc: next });
            }}
            list="dl-orgDesc"
            disabled={disabled}
          />
          {renderDatalist("dl-orgDesc", options?.orgDesc ?? [])}
        </div>

        <div className="field">
          <label>USO_TRAFO</label>
          <select
            value={form.usoTrafo}
            onChange={(e) => setForm({ ...form, usoTrafo: e.target.value as SolCdsNuevoCreateInput["usoTrafo"] })}
            disabled={disabled}
          >
            <option value="ENEL">ENEL</option>
            <option value="CLIENTE">CLIENTE</option>
          </select>
        </div>
        <div className="field">
          <label>PROPIEDAD</label>
          <select
            value={form.propiedad}
            onChange={(e) => setForm({ ...form, propiedad: e.target.value as SolCdsNuevoCreateInput["propiedad"] })}
            disabled={disabled}
          >
            <option value="ENEL">ENEL</option>
            <option value="CLIENTE">CLIENTE</option>
          </select>
        </div>
        <div className="field">
          <label>TIP_RED_TRANSFORMADOR</label>
          <select
            value={form.tipRedTransformador}
            onChange={(e) =>
              setForm({ ...form, tipRedTransformador: e.target.value as SolCdsNuevoCreateInput["tipRedTransformador"] })
            }
            disabled={disabled}
          >
            <option value="Subterranea">Subterranea</option>
            <option value="Aerea">Aerea</option>
          </select>
        </div>
        <div className="field">
          <label>FASE</label>
          <select value={form.fase} onChange={(e) => setForm({ ...form, fase: e.target.value as SolCdsNuevoCreateInput["fase"] })} disabled={disabled}>
            <option value="Trifasico">Trifasico</option>
            <option value="Bifasico">Bifasico</option>
            <option value="Monofasico">Monofasico</option>
          </select>
        </div>

        <div className="field">
          <label>COORDENADAS X</label>
          <input value={form.coordenadasX} onChange={(e) => setForm({ ...form, coordenadasX: e.target.value })} disabled={disabled} />
        </div>
        <div className="field">
          <label>COORDENADAS Y</label>
          <input value={form.coordenadasY} onChange={(e) => setForm({ ...form, coordenadasY: e.target.value })} disabled={disabled} />
        </div>

        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn" disabled={disabled}>
            {saving ? "Guardando..." : "Crear solicitud"}
          </button>
        </div>
      </form>
    </div>
  );
}
