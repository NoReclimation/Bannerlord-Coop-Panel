import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

  useEffect(() => {
    const boot = async () => {
      if (!getAccessToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.me();
        setUser(me.user);
        setPermissions(me.permissions);
      } catch {
        clearTokens();
      } finally {
        setLoading(false);
      }
    };
    void boot();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.login(username, password);
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
    setPermissions(data.permissions);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      clearTokens();
    }
    setUser(null);
    setPermissions([]);
  }, []);

  const can = useCallback(
    (permission: Permission) =>
      user ? hasPermission(user.role, permission) : false,
    [user],
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
