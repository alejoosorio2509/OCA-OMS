import { useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { resetPassword } from "../api";
import "./LoginPage.css";

export function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const initial = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return {
      email: p.get("email") ?? "",
      tempPassword: p.get("tempPassword") ?? ""
    };
  }, [location.search]);

  const [email, setEmail] = useState(initial.email);
  const [tempPassword, setTempPassword] = useState(initial.tempPassword);
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) {
      setError("La nueva contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirm) {
      setError("La confirmación no coincide.");
      return;
    }
    setLoading(true);
    try {
      await resetPassword({ email, tempPassword, newPassword });
      navigate("/login", { replace: true });
    } catch {
      setError("No se pudo restablecer la contraseña. Verifica el email y la contraseña temporal.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="card login-card">
        <div className="login-brand">
          <h1 className="login-title" style={{ marginBottom: 6 }}>Restablecer contraseña</h1>
          <p className="login-subtitle" style={{ marginTop: 0 }}>
            Solicita una contraseña temporal al administrador (Usuarios → Reset password).
          </p>
        </div>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label>Contraseña temporal</label>
            <input value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} type="password" autoComplete="one-time-code" />
          </div>
          <div className="field">
            <label>Nueva contraseña</label>
            <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" autoComplete="new-password" />
          </div>
          <div className="field">
            <label>Confirmar nueva contraseña</label>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" autoComplete="new-password" />
          </div>
          {error ? <div className="error">{error}</div> : null}
          <div className="actions" style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="btn" disabled={loading}>
              {loading ? "Guardando..." : "Cambiar contraseña"}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => navigate("/login")} disabled={loading}>
              Volver
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

