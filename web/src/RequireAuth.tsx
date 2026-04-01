import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./auth";

export function RequireAuth() {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

