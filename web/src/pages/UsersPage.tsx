import { useEffect, useState, type FormEvent } from "react";
import type { UserRole } from "../api";
import { createUser, listUsers, resetUserPassword, updateUser } from "../api";
import { useAuth } from "../auth";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getApiErrorData(err: unknown): Record<string, unknown> | null {
  if (!isRecord(err)) return null;
  if (!("data" in err)) return null;
  const data = (err as Record<string, unknown>).data;
  return isRecord(data) ? data : null;
}

function formatInvalidBody(details: unknown): string | null {
  if (!Array.isArray(details)) return null;
  const parts: string[] = [];
  for (const d of details) {
    if (!isRecord(d)) continue;
    const path = d.path;
    const message = d.message;
    if (!Array.isArray(path) || typeof message !== "string") continue;
    if (!path.every((p) => typeof p === "string" || typeof p === "number")) continue;
    parts.push(`${path.map(String).join(".")}: ${message}`);
  }
  return parts.length > 0 ? `Datos inválidos: ${parts.join(", ")}` : null;
}

export function UsersPage() {
  const { token, user } = useAuth();
  const [items, setItems] = useState<
    {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      canOrders?: boolean;
      canLevantamiento?: boolean;
      canSolCdsNuevos?: boolean;
      canAsignacionCompAt?: boolean;
      canCargues?: boolean;
      canExportes?: boolean;
      canUsers?: boolean;
      isTecnologo?: boolean;
      createdAt: string;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("USER");
  const [showPassword, setShowPassword] = useState(false);
  const [canOrders, setCanOrders] = useState(true);
  const [canLevantamiento, setCanLevantamiento] = useState(true);
  const [canSolCdsNuevos, setCanSolCdsNuevos] = useState(true);
  const [canAsignacionCompAt, setCanAsignacionCompAt] = useState(true);
  const [canCargues, setCanCargues] = useState(true);
  const [canExportes, setCanExportes] = useState(true);
  const [canUsers, setCanUsers] = useState(false);
  const [isTecnologo, setIsTecnologo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetPw, setResetPw] = useState<Record<string, string>>({});

  const modulesLabel = (u: {
    role: UserRole;
    canOrders?: boolean;
    canLevantamiento?: boolean;
    canSolCdsNuevos?: boolean;
    canAsignacionCompAt?: boolean;
    canCargues?: boolean;
    canExportes?: boolean;
    canUsers?: boolean;
  }) => {
    if (u.role === "ADMIN") return "Admin (todos)";
    const parts: string[] = [];
    if (u.canOrders) parts.push("Actualización");
    if (u.canLevantamiento) parts.push("Levantamiento");
    if (u.canSolCdsNuevos) parts.push("Sol. CDS Nuevos");
    if (u.canAsignacionCompAt) parts.push("Asig. comp. AT");
    if (u.canCargues) parts.push("Cargues");
    if (u.canExportes) parts.push("Exportes");
    if (u.canUsers) parts.push("Usuarios");
    return parts.length ? parts.join(" · ") : "Sin módulos";
  };

  function patchItem(
    id: string,
    patch: Partial<{
      email: string;
      name: string;
      role: UserRole;
      canOrders: boolean;
      canLevantamiento: boolean;
      canSolCdsNuevos: boolean;
      canAsignacionCompAt: boolean;
      canCargues: boolean;
      canExportes: boolean;
      canUsers: boolean;
      isTecnologo: boolean;
    }>
  ) {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function refresh() {
    const data = await listUsers(token!);
    setItems(data);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listUsers(token!)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudieron cargar los usuarios.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createUser(token!, {
        email,
        name,
        password,
        role,
        canOrders,
        canLevantamiento,
        canSolCdsNuevos,
        canAsignacionCompAt,
        canCargues,
        canExportes,
        canUsers,
        isTecnologo
      });
      setEmail("");
      setName("");
      setPassword("");
      setRole("USER");
      setShowPassword(false);
      setCanOrders(true);
      setCanLevantamiento(true);
      setCanSolCdsNuevos(true);
      setCanAsignacionCompAt(true);
      setCanCargues(true);
      setCanExportes(true);
      setCanUsers(false);
      setIsTecnologo(false);
      await refresh();
    } catch (err) {
      let msg = "No se pudo crear el usuario (¿email ya existe?).";
      const data = getApiErrorData(err);
      const code = typeof data?.error === "string" ? data.error : null;
      if (code === "INVALID_BODY") {
        msg = formatInvalidBody(data?.details) ?? msg;
      } else if (code === "EMAIL_IN_USE") {
        msg = "El email ya está en uso.";
      } else if (typeof data?.error === "string") {
        msg = data.error;
      }
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  const canManageUsers = user?.role === "ADMIN" || !!user?.canUsers;
  if (!canManageUsers) {
    return <div className="card">No autorizado.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 900 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Crear usuario</h2>
        <form onSubmit={onCreate}>
          <div className="row">
            <div className="field">
              <label>Nombre</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Contraseña</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPassword ? "text" : "password"} required />
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
                Mostrar
              </label>
            </div>
            <div className="field">
              <label>Rol</label>
              <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Permisos</label>
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={canOrders} onChange={(e) => setCanOrders(e.target.checked)} />
                  Actualización
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={canLevantamiento}
                    onChange={(e) => setCanLevantamiento(e.target.checked)}
                  />
                  Levantamiento
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={canSolCdsNuevos} onChange={(e) => setCanSolCdsNuevos(e.target.checked)} />
                  Sol. CDS Nuevos
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={canAsignacionCompAt} onChange={(e) => setCanAsignacionCompAt(e.target.checked)} />
                  Asignación comp. AT
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={canCargues} onChange={(e) => setCanCargues(e.target.checked)} />
                  Cargues
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={canExportes} onChange={(e) => setCanExportes(e.target.checked)} />
                  Exportes
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={canUsers} onChange={(e) => setCanUsers(e.target.checked)} />
                  Usuarios
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={isTecnologo} onChange={(e) => setIsTecnologo(e.target.checked)} />
                  Tecnólogo
                </label>
              </div>
            </div>
          </div>
          {error ? <div className="error">{error}</div> : null}
          <div className="actions">
            <button className="btn" disabled={saving}>
              {saving ? "Creando..." : "Crear"}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Usuarios</h2>
        {loading ? (
          <div style={{ color: "var(--muted)" }}>Cargando...</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Actualización</th>
                <th>Levantamiento</th>
                <th>Sol. CDS Nuevos</th>
                <th>Asig. comp. AT</th>
                <th>Cargues</th>
                <th>Exportes</th>
                <th>Usuarios</th>
                <th>Tecnólogo</th>
                <th>Módulos</th>
                <th>Creado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <input
                      value={u.name}
                      onChange={(e) => setItems((prev) => prev.map((p) => (p.id === u.id ? { ...p, name: e.target.value } : p)))}
                      onBlur={async () => {
                        try {
                          await updateUser(token!, u.id, { name: u.name });
                          await refresh();
                        } catch (err) {
                          const data = getApiErrorData(err);
                          const msg =
                            typeof data?.error === "string" && data.error === "INVALID_BODY"
                              ? formatInvalidBody(data.details) ?? "No se pudo actualizar el nombre."
                              : "No se pudo actualizar el nombre.";
                          setError(msg);
                          await refresh();
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input
                      value={u.email}
                      onChange={(e) => setItems((prev) => prev.map((p) => (p.id === u.id ? { ...p, email: e.target.value } : p)))}
                      onBlur={async () => {
                        try {
                          await updateUser(token!, u.id, { email: u.email });
                          await refresh();
                        } catch (err) {
                          let msg = "No se pudo actualizar el email (¿ya existe?).";
                          const data = getApiErrorData(err);
                          const code = typeof data?.error === "string" ? data.error : null;
                          if (code === "INVALID_BODY") {
                            msg = formatInvalidBody(data?.details) ?? msg;
                          } else if (code === "EMAIL_IN_USE") {
                            msg = "El email ya está en uso.";
                          } else if (typeof data?.error === "string") {
                            msg = data.error;
                          }
                          setError(msg);
                          await refresh();
                        }
                      }}
                    />
                  </td>
                  <td>
                    <select
                      value={u.role}
                      onChange={async (e) => {
                        const next = e.target.value as UserRole;
                        setError(null);
                        patchItem(u.id, { role: next });
                        try {
                          await updateUser(token!, u.id, { role: next });
                          await refresh();
                        } catch (err) {
                          const data = getApiErrorData(err);
                          const code = typeof data?.error === "string" ? data.error : null;
                          const msg =
                            code === "INVALID_BODY"
                              ? formatInvalidBody(data?.details) ?? "No se pudo actualizar el rol."
                              : typeof data?.error === "string"
                                ? data.error
                                : "No se pudo actualizar el rol.";
                          setError(msg);
                          await refresh();
                        }
                      }}
                    >
                      <option value="USER">USER</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.canOrders ?? false}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        setError(null);
                        patchItem(u.id, { canOrders: next });
                        try {
                          await updateUser(token!, u.id, { canOrders: next });
                          await refresh();
                        } catch (err) {
                          const data = getApiErrorData(err);
                          const msg = typeof data?.error === "string" ? data.error : "No se pudo actualizar el permiso de Órdenes.";
                          setError(msg);
                          await refresh();
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.canLevantamiento ?? false}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        setError(null);
                        patchItem(u.id, { canLevantamiento: next });
                        try {
                          await updateUser(token!, u.id, { canLevantamiento: next });
                          await refresh();
                        } catch (err) {
                          const data = getApiErrorData(err);
                          const msg = typeof data?.error === "string" ? data.error : "No se pudo actualizar el permiso de Levantamiento.";
                          setError(msg);
                          await refresh();
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.canSolCdsNuevos ?? false}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        setError(null);
                        patchItem(u.id, { canSolCdsNuevos: next });
                        try {
                          await updateUser(token!, u.id, { canSolCdsNuevos: next });
                          await refresh();
                        } catch (err) {
                          const data = getApiErrorData(err);
                          const msg = typeof data?.error === "string" ? data.error : "No se pudo actualizar el permiso de Sol. CDS Nuevos.";
                          setError(msg);
                          await refresh();
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.canAsignacionCompAt ?? false}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        setError(null);
                        patchItem(u.id, { canAsignacionCompAt: next });
                        try {
                          await updateUser(token!, u.id, { canAsignacionCompAt: next });
                          await refresh();
                        } catch (err) {
                          const data = getApiErrorData(err);
                          const msg = typeof data?.error === "string" ? data.error : "No se pudo actualizar el permiso de Asignación comp. AT.";
                          setError(msg);
                          await refresh();
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.canCargues ?? false}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        setError(null);
                        patchItem(u.id, { canCargues: next });
                        try {
                          await updateUser(token!, u.id, { canCargues: next });
                          await refresh();
                        } catch (err) {
                          const data = getApiErrorData(err);
                          const msg = typeof data?.error === "string" ? data.error : "No se pudo actualizar el permiso de Cargues.";
                          setError(msg);
                          await refresh();
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.canExportes ?? false}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        setError(null);
                        patchItem(u.id, { canExportes: next });
                        try {
                          await updateUser(token!, u.id, { canExportes: next });
                          await refresh();
                        } catch (err) {
                          const data = getApiErrorData(err);
                          const msg = typeof data?.error === "string" ? data.error : "No se pudo actualizar el permiso de Exportes.";
                          setError(msg);
                          await refresh();
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.canUsers ?? false}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        setError(null);
                        patchItem(u.id, { canUsers: next });
                        try {
                          await updateUser(token!, u.id, { canUsers: next });
                          await refresh();
                        } catch (err) {
                          const data = getApiErrorData(err);
                          const msg = typeof data?.error === "string" ? data.error : "No se pudo actualizar el permiso de Usuarios.";
                          setError(msg);
                          await refresh();
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.isTecnologo ?? false}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        setError(null);
                        patchItem(u.id, { isTecnologo: next });
                        try {
                          await updateUser(token!, u.id, { isTecnologo: next });
                          await refresh();
                        } catch (err) {
                          const data = getApiErrorData(err);
                          const msg = typeof data?.error === "string" ? data.error : "No se pudo actualizar Tecnólogo.";
                          setError(msg);
                          await refresh();
                        }
                      }}
                    />
                  </td>
                  <td style={{ color: "var(--muted)", fontSize: 13 }}>{modulesLabel(u)}</td>
                  <td>{new Date(u.createdAt).toLocaleString()}</td>
                  <td>
                    <button
                      className="btn btn-sm"
                      onClick={async () => {
                        const r = await resetUserPassword(token!, u.id);
                        setResetPw((prev) => ({ ...prev, [u.id]: r.password }));
                      }}
                    >
                      Reset password
                    </button>
                    {resetPw[u.id] ? (
                      <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                        <div style={{ fontFamily: "monospace" }}>{resetPw[u.id]}</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            className="btn btn-sm btn-secondary"
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(resetPw[u.id]);
                              } catch {
                                return;
                              }
                            }}
                          >
                            Copiar
                          </button>
                          <a className="btn btn-sm btn-secondary" href={`/reset-password?email=${encodeURIComponent(u.email)}`} target="_blank" rel="noreferrer">
                            Abrir restablecer
                          </a>
                        </div>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
