import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser, Permission } from '@bannerlord-panel/shared';
import { hasPermission } from '@bannerlord-panel/shared';
import {
  api,
  clearTokens,
  getAccessToken,
  setTokens,
} from './api';

interface AuthState {
  user: AuthUser | null;
  permissions: Permission[];
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  /** Bumped on login/logout so a stale boot `me()` can't wipe fresh tokens. */
  const authEpoch = useRef(0);

  useEffect(() => {
    const bootEpoch = authEpoch.current;
    const boot = async () => {
      if (!getAccessToken()) {
        if (bootEpoch === authEpoch.current) setLoading(false);
        return;
      }
      try {
        const me = await api.me();
        if (bootEpoch !== authEpoch.current) return;
        setUser(me.user);
        setPermissions(me.permissions);
      } catch {
        if (bootEpoch !== authEpoch.current) return;
        clearTokens();
        setUser(null);
        setPermissions([]);
      } finally {
        if (bootEpoch === authEpoch.current) setLoading(false);
      }
    };
    void boot();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    authEpoch.current += 1;
    clearTokens();
    const data = await api.login(username, password);
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
    setPermissions(data.permissions);
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    authEpoch.current += 1;
    try {
      await api.logout();
    } catch {
      clearTokens();
    }
    setUser(null);
    setPermissions([]);
  }, []);

  const can = useCallback(
    (permission: Permission) => {
      if (!user) return false;
      // Role matrix is source of truth; also honor server-issued list if present.
      return (
        hasPermission(user.role, permission) || permissions.includes(permission)
      );
    },
    [user, permissions],
  );

  const value = useMemo(
    () => ({ user, permissions, loading, login, logout, can }),
    [user, permissions, loading, login, logout, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requires AuthProvider');
  return ctx;
}
