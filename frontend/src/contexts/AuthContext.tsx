import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib';
import type { Session, SessionUser } from '../types';

type AuthContextValue = {
  token: string | null;
  user: SessionUser | null;
  isReady: boolean;
  login: (email: string, password: string) => Promise<void>;
  applySession: (session: Session) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const STORAGE_KEY = 'food-delivery-v2-session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const session = JSON.parse(raw) as Session;
        setToken(session.token);
        setUser(session.user);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setIsReady(true);
  }, []);

  function applySession(session: Session) {
    setToken(session.token);
    setUser(session.user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }

  async function login(email: string, password: string) {
    const session = await api<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    applySession(session);
  }

  function logout() {
    setToken(null);
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  const value = useMemo(() => ({ token, user, isReady, login, applySession, logout }), [token, user, isReady]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
