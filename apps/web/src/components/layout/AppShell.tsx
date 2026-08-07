import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Server,
  Network,
  Package,
  Puzzle,
  LogOut,
  Users,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Permission } from '@bannerlord-panel/shared';

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** null = always visible when signed in */
  permission: Permission | null;
  /** Extra gate (OR). If set, at least one must pass in addition to permission. */
  anyOf?: Permission[];
};

const links: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    permission: null,
  },
  {
    to: '/mods',
    label: 'Mods',
    icon: Puzzle,
    permission: 'installations:read',
  },
  {
    to: '/users',
    label: 'Users',
    icon: Users,
    permission: null,
    anyOf: ['users:manage', 'servers:assign'],
  },
  {
    to: '/installations',
    label: 'Installations',
    icon: Package,
    permission: 'installations:read',
  },
  {
    to: '/hosts',
    label: 'Hosts',
    icon: Network,
    permission: 'hosts:read',
  },
];

export function AppShell() {
  const { user, logout, can } = useAuth();

  const visible = links.filter((item) => {
    if (item.anyOf) {
      return item.anyOf.some((p) => can(p));
    }
    return item.permission === null || can(item.permission);
  });

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
          {visible.map(({ to, label, icon: Icon }) => (
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
