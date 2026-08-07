import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import type { Permission } from '@bannerlord-panel/shared';
import { AuthProvider, useAuth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { HostsPage } from '@/pages/HostsPage';
import { InstallationsPage } from '@/pages/InstallationsPage';
import { ServerPage } from '@/pages/ServerPage';
import { UsersPage } from '@/pages/UsersPage';
import { ModsPage } from '@/pages/ModsPage';

function Protected() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequirePermission({
  permission,
  anyOf,
}: {
  permission?: Permission;
  anyOf?: Permission[];
}) {
  const { can } = useAuth();
  const allowed = anyOf
    ? anyOf.some((p) => can(p))
    : permission
      ? can(permission)
      : false;
  if (!allowed) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Protected />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route
              element={
                <RequirePermission permission="installations:read" />
              }
            >
              <Route path="mods" element={<ModsPage />} />
              <Route path="installations" element={<InstallationsPage />} />
            </Route>
            <Route element={<RequirePermission permission="hosts:read" />}>
              <Route path="hosts" element={<HostsPage />} />
            </Route>
            <Route
              element={
                <RequirePermission
                  anyOf={['users:manage', 'servers:assign']}
                />
              }
            >
              <Route path="users" element={<UsersPage />} />
            </Route>
            <Route path="servers/:id" element={<ServerPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
