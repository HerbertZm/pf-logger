import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../api/client';
import type { LoginResponse, MeResponse } from '../api/types';

interface AuthState {
  token: string | null;
  username: string | null;
  isAdmin: boolean;
  isSuperadmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'));
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperadmin, setSuperadmin] = useState(false);

  const applyRole = (role: string) => {
    setIsAdmin(role === 'admin' || role === 'superadmin');
    setSuperadmin(role === 'superadmin');
  };

  const clearState = () => {
    setToken(null);
    setUsername(null);
    setIsAdmin(false);
    setSuperadmin(false);
  };

  // Validate stored token on mount
  useEffect(() => {
    if (!token) return;
    api
      .get<MeResponse>('/api/me')
      .then((me) => {
        setUsername(me.username);
        applyRole(me.role);
      })
      .catch(() => {
        localStorage.removeItem('auth_token');
        clearState();
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle 401 from anywhere in the app
  useEffect(() => {
    const onExpired = () => {
      localStorage.removeItem('auth_token');
      clearState();
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const login = async (u: string, p: string): Promise<void> => {
    const {
      token: t,
      username: name,
      role,
    } = await api.post<LoginResponse>('/api/login', {
      username: u,
      password: p,
    });
    localStorage.setItem('auth_token', t);
    setToken(t);
    setUsername(name);
    applyRole(role);
    // Signal other contexts (e.g. TournamentContext) to re-fetch after login
    window.dispatchEvent(new Event('auth:login'));
  };

  const logout = async (): Promise<void> => {
    await api.post('/api/logout', {}).catch(() => {});
    localStorage.removeItem('auth_token');
    clearState();
    window.dispatchEvent(new Event('auth:logout'));
  };

  return (
    <AuthContext.Provider value={{ token, username, isAdmin, isSuperadmin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
