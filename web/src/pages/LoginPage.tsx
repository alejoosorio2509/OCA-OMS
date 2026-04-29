import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import "./LoginPage.css";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? "/orders", { replace: true });
    } catch (err) {
      if (err instanceof TypeError) {
        setError("No se pudo conectar al servidor. Revisa IP/puerto o CORS.");
      } else {
        setError("Credenciales inválidas.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="card login-card">
        <div className="login-brand">
          <div className="login-logo-wrap">
            <img className="login-logo" src="/logo.png" alt="OCA Global" />
          </div>
          <h1 className="login-title">OCA OMS</h1>
          <p className="login-subtitle">Sistema de gestión de órdenes</p>
        </div>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </div>
          {error ? <div className="error">{error}</div> : null}
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn" disabled={loading}>
              {loading ? "Ingresando..." : "Ingresar"}
            </button>
          </div>
          <div style={{ marginTop: 10, fontSize: 13 }}>
            <button className="btn btn-secondary" type="button" onClick={() => navigate("/reset-password")}>
              Olvidé mi contraseña
            </button>
          </div>
          <div style={{ marginTop: 12, color: "#bdbdbd", fontSize: 13 }}>
            Contacto:Jose.Osorio@ocaglobal.com 
            Tel:3204543280
          </div>
        </form>
      </div>
    </div>
  );
}
