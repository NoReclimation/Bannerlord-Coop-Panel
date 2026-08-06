import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Server,
  Network,
  Package,
  LogOut,
  Users,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const links = [
  {
    to: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    permission: null as null | 'installations:read' | 'hosts:read',
  },
  {
    to: '/installations',
    label: 'Installations',
    icon: Package,
    permission: 'installations:read' as const,
  },
  {
    to: '/hosts',
    label: 'Hosts',
    icon: Network,
    permission: 'hosts:read' as const,
  },
];

export function AppShell() {
  const { user, logout, can } = useAuth();

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px]">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-border bg-surface/80 px-3 py-5 backdrop-blur">
        <div className="px-2 pb-6">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-accent">
            BANNERLORD
          </p>
          <h1 className="mt-1 text-lg font-semibold leading-tight">
            Coop Panel
          </h1>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {links
            .filter(
              ({ permission }) => permission === null || can(permission),
            )
            .map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-text',
                    isActive && 'bg-surface-2 text-text',
                  )
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          {can('users:manage') || can('servers:assign') ? (
            <NavLink
              to="/users"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-text',
                  isActive && 'bg-surface-2 text-text',
                )
              }
            >
              <Users className="size-4" />
              Users
            </NavLink>
          ) : null}
        </nav>
        <div className="mt-auto border-t border-border px-2 pt-4">
          <p className="truncate text-sm text-text">
            {user?.displayName || user?.username}
          </p>
          <p className="text-xs capitalize text-muted">{user?.role}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start gap-2 px-0"
            onClick={() => void logout()}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-6 py-6 md:px-8">
        <Outlet />
      </main>
    </div>
  );
}

export function ServerIcon() {
  return <Server className="size-4" />;
}
