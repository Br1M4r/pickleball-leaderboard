import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../api';
import { tokenStore } from '../api/client';

const AuthContext = createContext(null);
const USER_KEY = 'pb_user';

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => (tokenStore.get() ? readStoredUser() : null));
  const [ready, setReady] = useState(!tokenStore.get());

  const saveSession = useCallback(({ token, user: u }) => {
    tokenStore.set(token);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  // Validate a stored token on startup.
  useEffect(() => {
    if (!tokenStore.get()) return;
    authApi
      .me()
      .then((u) => {
        localStorage.setItem(USER_KEY, JSON.stringify(u));
        setUser(u);
      })
      .catch(() => logout())
      .finally(() => setReady(true));
  }, [logout]);

  useEffect(() => {
    const onExpired = () => logout();
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [logout]);

  const value = useMemo(
    () => ({
      user,
      ready,
      isAdmin: user?.role === 'Admin',
      async login(email, password) {
        const res = await authApi.login(email, password);
        saveSession(res);
        return res.user;
      },
      async register(data) {
        const res = await authApi.register(data);
        saveSession(res);
        return res.user;
      },
      async refresh() {
        const u = await authApi.me();
        localStorage.setItem(USER_KEY, JSON.stringify(u));
        setUser(u);
      },
      logout,
    }),
    [user, ready, saveSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
