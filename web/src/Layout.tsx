import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./auth";
import "./layout.css";

export function Layout() {
  const { user, logout } = useAuth();
  const canOrders = user?.role === "ADMIN" || !!user?.canOrders;
  const canLevantamiento = user?.role === "ADMIN" || !!user?.canLevantamiento;
  const canCargues = user?.role === "ADMIN" || !!user?.canCargues;
  const canExportes = user?.role === "ADMIN" || !!user?.canExportes;
  const canUsers = user?.role === "ADMIN" || !!user?.canUsers;
  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">
          <Link to="/orders" className="brand-link">
            <span className="brand-logo-wrap">
              <img
                className="brand-logo"
                src="/logo.png"
                alt="OCA Global"
                onError={(e) => {
                  e.currentTarget.src = "/favicon.svg";
                }}
              />
            </span>
            <span className="brand-name">OCA OMS</span>
          </Link>
        </div>
        <nav className="nav">
          {canOrders ? <NavLink to="/orders" end>Actualización</NavLink> : null}
          {canLevantamiento ? <NavLink to="/levantamiento">Levantamiento</NavLink> : null}
          {canCargues ? <NavLink to="/cargues">Cargues</NavLink> : null}
          {canExportes ? <NavLink to="/exportes">Exportes</NavLink> : null}
          {canUsers ? <NavLink to="/users">Usuarios</NavLink> : null}
        </nav>
        <div className="account">
          {user ? (
            <>
              <span className="who">
                {user.name} ({user.role})
              </span>
              <button className="btn" onClick={logout}>
                Salir
              </button>
            </>
          ) : null}
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
