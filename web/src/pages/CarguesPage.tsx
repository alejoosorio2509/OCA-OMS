import { useState } from "react";
import { useAuth } from "../auth";
import "./CarguesPage.css";
import { API_URL } from "../apiUrl";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type UploadType =
  | "ACTUALIZACION"
  | "DEVOLUCIONES"
  | "CALENDARIO"
  | "ACTIVIDADES_BAREMO"
  | "RECORRIDO_INCREMENTOS"
  | "LEVANTAMIENTO"
  | "ENTREGA_LEVANTAMIENTO"
  | "MODELO_CATEGORIA_MB"
  | "CIRCUITOS_SUBESTACIONES"
  | "UNIDADES_TERRITORIALES"
  | "COMPONENTES_AT"
  | "ASIGNACION_COMP_AT";

export function CarguesPage() {
  const { token, user } = useAuth();
  const canCargues = user?.role === "ADMIN" || !!user?.canCargues;
  const [file, setFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState<UploadType>("ACTUALIZACION");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);

  if (!canCargues) return <div className="card">No autorizado.</div>;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setMessage(null);
      setErrorDetails([]);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setMessage({ text: "Por favor selecciona un archivo", type: "error" });
      return;
    }

    setLoading(true);
    setMessage(null);
    setErrorDetails([]);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", uploadType);
    formData.append("async", "1");

    try {
      const res = await fetch(`${API_URL}/cargues/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });

      const raw = await res.text();
      let data: unknown = null;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { message: raw };
      }

      const obj = (typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {}) as Record<
        string,
        unknown
      >;

      if (!res.ok) {
        const details = (obj.details ?? obj.error ?? obj.message) as string | undefined;
        throw new Error(details || "Error al subir el archivo");
      }

      if (typeof obj.jobId === "string" && obj.jobId.trim()) {
        const jobId = obj.jobId.trim();
        setMessage({ text: "Procesando cargue en servidor...", type: "success" });
        const start = Date.now();
        for (;;) {
          if (Date.now() - start > 30 * 60 * 1000) {
            throw new Error("El cargue está tardando demasiado. Revisa Render Logs.");
          }
          await new Promise((r) => setTimeout(r, 2000));
          let jobRes: Response;
          try {
            jobRes = await fetch(`${API_URL}/cargues/jobs/${jobId}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
          } catch {
            continue;
          }
          const job = (await jobRes.json().catch(() => null)) as unknown;
          if (!jobRes.ok) {
            if (jobRes.status === 404) continue;
            continue;
          }
          const jobObj = isRecord(job) ? job : {};
          const status = typeof jobObj.status === "string" ? jobObj.status : "";
          if (status === "RUNNING" || status === "QUEUED") continue;
          if (status === "ERROR") {
            const errMsg = typeof jobObj.error === "string" ? jobObj.error : "Error en el cargue";
            throw new Error(errMsg);
          }
          const result = isRecord(jobObj.result) ? jobObj.result : {};
          const errorsCount = typeof result.errors === "number" ? result.errors : 0;
          const message = typeof result.message === "string" ? result.message : "Carga finalizada.";
          setMessage({ text: message, type: errorsCount > 0 ? "error" : "success" });
          const details = Array.isArray(result.errorDetails) ? result.errorDetails : [];
          if (details.length > 0 && details.every((v: unknown) => typeof v === "string")) setErrorDetails(details as string[]);
          if (errorsCount === 0) {
            setFile(null);
            const fileInput = document.getElementById("fileInput") as HTMLInputElement;
            if (fileInput) fileInput.value = "";
          }
          return;
        }
      }

      const errorsCount = typeof obj.errors === "number" ? (obj.errors as number) : 0;
      const message = typeof obj.message === "string" ? obj.message : "Carga finalizada.";
      setMessage({ text: message, type: errorsCount > 0 ? "error" : "success" });

      const details = Array.isArray(obj.errorDetails) ? obj.errorDetails : [];
      if (details.length > 0 && details.every((v) => typeof v === "string")) setErrorDetails(details as string[]);
      
      if (errorsCount === 0) {
        setFile(null);
        const fileInput = document.getElementById("fileInput") as HTMLInputElement;
        if (fileInput) fileInput.value = "";
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error de conexión";
      setMessage({ text: msg, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card cargues-page">
      <h2>Sección de Cargues</h2>
      <p className="description">
        Sube archivos de cargue en formato CSV o Excel.
      </p>

      <form onSubmit={handleUpload} className="upload-form">
        <div className="field">
          <label>Tipo de Carga</label>
          <select 
            value={uploadType} 
            onChange={(e) => setUploadType(e.target.value as UploadType)}
            disabled={loading}
          >
            <option value="ACTUALIZACION">Actualización</option>
            <option value="DEVOLUCIONES">Devoluciones</option>
            <option value="CALENDARIO">Calendario</option>
            <option value="ACTIVIDADES_BAREMO">Actividades Baremo</option>
            <option value="RECORRIDO_INCREMENTOS">Recorrido Incrementos</option>
            <option value="LEVANTAMIENTO">Levantamiento</option>
            <option value="ENTREGA_LEVANTAMIENTO">Entrega Levantamiento</option>
            <option value="MODELO_CATEGORIA_MB">Modelo Categoría MB</option>
            <option value="CIRCUITOS_SUBESTACIONES">Circuitos/Subestaciones</option>
            <option value="UNIDADES_TERRITORIALES">Unidades territoriales</option>
            <option value="COMPONENTES_AT">Cargue componentes AT</option>
            <option value="ASIGNACION_COMP_AT">Asignacion comp. AT</option>
          </select>
        </div>

        <div className="field">
          <label>Archivo (CSV, Excel)</label>
          <input 
            id="fileInput"
            type="file" 
            accept=".csv, .xlsx, .xls" 
            onChange={handleFileChange}
            disabled={loading}
          />
        </div>

        {message && (
          <div className={`message ${message.type}`}>
            {message.text}
          </div>
        )}

        {errorDetails.length > 0 && (
          <div className="error-list">
            <h4>Detalles de errores:</h4>
            <ul>
              {errorDetails.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="actions">
          <button type="submit" className="btn" disabled={loading || !file}>
            {loading ? "Cargando..." : "Subir Archivo"}
          </button>
        </div>
      </form>

      <div className="info-box">
        <h3>Instrucciones</h3>
        <ul>
          <li>Asegúrate de que el archivo tenga el formato correcto.</li>
          <li>Se recomienda cargar el archivo de actualización de bloques de 4k.</li>
          <li>Los archivos permitidos son .csv, .xlsx y .xls.</li>
          <li>Actualización/Devoluciones/Calendario/Recorrido Incrementos: máximo 50MB.</li>
          <li>Actividades Baremo: máximo 100MB.</li>
        </ul>
        {uploadType === "CIRCUITOS_SUBESTACIONES" ? (
          <>
            <h4 style={{ marginTop: 12 }}>Columnas requeridas (Circuitos/Subestaciones)</h4>
            <ul>
              <li>COD_CIRCUITO</li>
              <li>NOM_CIRCUITO</li>
              <li>NOM_SUBESTACION</li>
            </ul>
          </>
        ) : null}
        {uploadType === "UNIDADES_TERRITORIALES" ? (
          <>
            <h4 style={{ marginTop: 12 }}>Columnas requeridas (Unidades territoriales)</h4>
            <ul>
              <li>MUNICIPIO</li>
              <li>TER_DESC</li>
              <li>ORG_DESC</li>
            </ul>
          </>
        ) : null}
        {uploadType === "COMPONENTES_AT" ? (
          <>
            <h4 style={{ marginTop: 12 }}>Columnas requeridas (Cargue componentes AT)</h4>
            <ul>
              <li>CODIGO</li>
              <li>TIPO</li>
              <li>FECHA ASIGNA ENEL</li>
            </ul>
          </>
        ) : null}
        {uploadType === "ASIGNACION_COMP_AT" ? (
          <>
            <h4 style={{ marginTop: 12 }}>Columnas requeridas (Asignación comp. AT)</h4>
            <ul>
              <li>FECHA ASIGNACION ENEL</li>
              <li>ROTULO</li>
              <li>TIPO</li>
              <li>TECNOLOGO</li>
              <li>FECHA ASIGNACION</li>
              <li>FECHA DE INSTALACION</li>
              <li>ESTADO</li>
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
