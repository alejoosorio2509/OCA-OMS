import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import { RequireAuth } from "./RequireAuth";
import { Layout } from "./Layout";
import { LoginPage } from "./pages/LoginPage";
import { OrdersPage } from "./pages/OrdersPage";
import { OrderDetailsPage } from "./pages/OrderDetailsPage";
import { UsersPage } from "./pages/UsersPage";
import { CarguesPage } from "./pages/CarguesPage";
import { ExportesPage } from "./pages/ExportesPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/orders" replace />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:id" element={<OrderDetailsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/cargues" element={<CarguesPage />} />
            <Route path="/exportes" element={<ExportesPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
