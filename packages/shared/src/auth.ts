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
    'settings:read',
    'console:read',
    'console:write',
  ],
  user: [
    'servers:read',
    'servers:control',
    'settings:read',
    'console:read',
  ],
};

export function permissionsFor(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.user;
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.user).includes(permission);
}

/** Admins and moderators see every server; users only see assigned ones. */
export function seesAllServers(role: UserRole): boolean {
  return role === 'admin' || role === 'moderator';
}
