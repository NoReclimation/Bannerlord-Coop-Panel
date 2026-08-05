export type UserRole = 'admin' | 'moderator' | 'viewer';

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
  | 'servers:control'
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
    'servers:control',
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
    'servers:control',
    'installations:read',
    'hosts:read',
    'settings:read',
    'console:read',
    'console:write',
  ],
  viewer: [
    'servers:read',
    'installations:read',
    'hosts:read',
    'settings:read',
    'console:read',
  ],
};

export function permissionsFor(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
