export type UserRole = 'admin' | 'moderator' | 'user';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  displayName?: string | null;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type Permission =
  | 'servers:read'
  | 'servers:write'
  | 'servers:create'
  | 'servers:delete'
  | 'servers:delete-request'
  | 'servers:control'
  | 'servers:kill'
  | 'servers:stop-all'
  | 'servers:assign'
  | 'installations:read'
  | 'installations:write'
  | 'hosts:read'
  | 'hosts:write'
  | 'users:manage'
  | 'settings:read'
  | 'settings:write'
  | 'console:read'
  | 'console:write';

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: [
    'servers:read',
    'servers:write',
    'servers:create',
    'servers:delete',
    'servers:delete-request',
    'servers:control',
    'servers:kill',
    'servers:stop-all',
    'servers:assign',
    'installations:read',
    'installations:write',
    'hosts:read',
    'hosts:write',
    'users:manage',
    'settings:read',
    'settings:write',
    'console:read',
    'console:write',
  ],
  moderator: [
    'servers:read',
    'servers:write',
    'servers:create',
    'servers:delete-request',
    'servers:control',
    'servers:stop-all',
    'servers:assign',
    'installations:read',
    'settings:read',
    'console:read',
    'console:write',
  ],
  user: [
    'servers:read',
    'servers:write',
    'servers:control',
    'settings:read',
    'console:read',
    'console:write',
  ],
};

/** Map legacy DB roles (e.g. `viewer`) and unknown values onto the current matrix. */
export function normalizeRole(role: string | null | undefined): UserRole {
  if (role === 'admin' || role === 'moderator' || role === 'user') return role;
  // Pre-008 schema used `viewer` for the limited end-user role.
  if (role === 'viewer') return 'user';
  return 'user';
}

export function permissionsFor(role: string): readonly Permission[] {
  return ROLE_PERMISSIONS[normalizeRole(role)];
}

export function hasPermission(role: string, permission: Permission): boolean {
  return ROLE_PERMISSIONS[normalizeRole(role)].includes(permission);
}

/** Admins and moderators see every server; users only see assigned ones. */
export function seesAllServers(role: string): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'admin' || normalized === 'moderator';
}
