import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { User, WorkOrderCriticality } from "../api";
import { createWorkOrder, listUsers } from "../api";
import { useAuth } from "../auth";

const criticalities: { value: WorkOrderCriticality; label: string }[] = [
  { value: "LOW", label: "Baja" },
  { value: "MEDIUM", label: "Media" },
  { value: "HIGH", label: "Alta" },
  { value: "CRITICAL", label: "Crítica" }
];

export function NewOrderPage() {
  const { token, user } = useAuth();
  const canOrders = user?.role === "ADMIN" || !!user?.canOrders;
  const navigate = useNavigate();

  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criticality, setCriticality] = useState<WorkOrderCriticality>("MEDIUM");
  const [estimatedMinutes, setEstimatedMinutes] = useState<string>("");
  const [dueAtLocal, setDueAtLocal] = useState<string>("");
  const [assigneeId, setAssigneeId] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingUsers(true);
    listUsers(token!)
      .then((data) => {
        if (!cancelled) setUsers(data);
      })
      .finally(() => {
        if (!cancelled) setLoadingUsers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const dueAtIso = useMemo(() => {
    if (!dueAtLocal) return undefined;
    const d = new Date(dueAtLocal);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  }, [dueAtLocal]);

  if (!canOrders) return <div className="card">No autorizado.</div>;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const estimated = estimatedMinutes.trim() ? Number(estimatedMinutes) : undefined;
      const created = await createWorkOrder(token!, {
        title,
        description: description.trim() || undefined,
        criticality,
        estimatedMinutes: estimated,
        dueAt: dueAtIso,
        assigneeId: assigneeId || undefined
      });
      navigate(`/orders/${created.id}`);
    } catch {
      setError("No se pudo crear la orden.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 780 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Crear orden</h2>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Título</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="field">
            <label>Descripción</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </div>

          <div className="row">
            <div className="field">
              <label>Criticidad</label>
              <select
                value={criticality}
                onChange={(e) => setCriticality(e.target.value as WorkOrderCriticality)}
              >
                {criticalities.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Tiempo estimado (minutos)</label>
              <input
                value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(e.target.value)}
                inputMode="numeric"
                placeholder="180"
              />
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label>Vencimiento</label>
              <input type="datetime-local" value={dueAtLocal} onChange={(e) => setDueAtLocal(e.target.value)} />
            </div>
            <div className="field">
              <label>Asignar a</label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                disabled={loadingUsers}
              >
                <option value="">(sin asignar)</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error ? <div className="error">{error}</div> : null}
          <div className="actions">
            <button className="btn" disabled={saving}>
              {saving ? "Guardando..." : "Crear"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
