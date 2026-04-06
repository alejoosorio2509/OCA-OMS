import { useEffect, useState, type FormEvent } from "react";
import type { UserRole } from "../api";
import { createUser, listUsers, resetUserPassword, updateUser } from "../api";
import { useAuth } from "../auth";

export function UsersPage() {
  const { token, user } = useAuth();
  const [items, setItems] = useState<
    {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      canOrders?: boolean;
      canCargues?: boolean;
      canExportes?: boolean;
      canUsers?: boolean;
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
  const [canCargues, setCanCargues] = useState(true);
  const [canExportes, setCanExportes] = useState(true);
  const [canUsers, setCanUsers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetPw, setResetPw] = useState<Record<string, string>>({});

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
      await createUser(token!, { email, name, password, role, canOrders, canCargues, canExportes, canUsers });
      setEmail("");
      setName("");
      setPassword("");
      setRole("USER");
      setShowPassword(false);
      setCanOrders(true);
      setCanCargues(true);
      setCanExportes(true);
      setCanUsers(false);
      await refresh();
    } catch (err: any) {
      let msg = "No se pudo crear el usuario (¿email ya existe?).";
      if (err?.data?.error === "INVALID_BODY" && Array.isArray(err.data.details)) {
        msg = "Datos inválidos: " + err.data.details.map((d: any) => `${d.path.join(".")}: ${d.message}`).join(", ");
      } else if (err?.data?.error === "EMAIL_IN_USE") {
        msg = "El email ya está en uso.";
      } else if (err?.data?.error) {
        msg = err.data.error;
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
                  Órdenes
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
                <th>Órdenes</th>
                <th>Cargues</th>
                <th>Exportes</th>
                <th>Usuarios</th>
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
                        } catch (err: any) {
                          setError(err?.data?.error === "INVALID_BODY" && Array.isArray(err.data.details) ? "Datos inválidos: " + err.data.details.map((d: any) => `${d.path.join(".")}: ${d.message}`).join(", ") : "No se pudo actualizar el nombre.");
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
                        } catch (err: any) {
                          let msg = "No se pudo actualizar el email (¿ya existe?).";
                          if (err?.data?.error === "INVALID_BODY" && Array.isArray(err.data.details)) {
                            msg = "Datos inválidos: " + err.data.details.map((d: any) => `${d.path.join(".")}: ${d.message}`).join(", ");
                          } else if (err?.data?.error === "EMAIL_IN_USE") {
                            msg = "El email ya está en uso.";
                          } else if (err?.data?.error) {
                            msg = err.data.error;
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
                        await updateUser(token!, u.id, { role: next });
                        await refresh();
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
                        await updateUser(token!, u.id, { canOrders: e.target.checked });
                        await refresh();
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.canCargues ?? false}
                      onChange={async (e) => {
                        await updateUser(token!, u.id, { canCargues: e.target.checked });
                        await refresh();
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.canExportes ?? false}
                      onChange={async (e) => {
                        await updateUser(token!, u.id, { canExportes: e.target.checked });
                        await refresh();
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={u.canUsers ?? false}
                      onChange={async (e) => {
                        await updateUser(token!, u.id, { canUsers: e.target.checked });
                        await refresh();
                      }}
                    />
                  </td>
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
                      <div style={{ marginTop: 6, fontFamily: "monospace" }}>{resetPw[u.id]}</div>
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
