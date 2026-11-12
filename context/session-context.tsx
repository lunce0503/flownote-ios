import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { flownoteApi, type FlownoteUser, type LoginResponse } from '@/lib/flownote-api';

type SessionContextValue = {
  token: string | null;
  user: FlownoteUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResponse>;
  register: (input: {
    username: string;
    email: string;
    password: string;
    nickname: string;
  }) => Promise<FlownoteUser>;
  logout: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);
const SESSION_TOKEN_STORAGE_KEY = 'flownote.mobile.session.token';
const SESSION_USER_STORAGE_KEY = 'flownote.mobile.session.user';

export function SessionProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<FlownoteUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const restoreSession = async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          AsyncStorage.getItem(SESSION_TOKEN_STORAGE_KEY),
          AsyncStorage.getItem(SESSION_USER_STORAGE_KEY),
        ]);

        if (!mounted) return;
        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser) as FlownoteUser);
        }
      } catch {
        await AsyncStorage.multiRemove([SESSION_TOKEN_STORAGE_KEY, SESSION_USER_STORAGE_KEY]);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void restoreSession();

    return () => {
      mounted = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const session = await flownoteApi.login(email.trim(), password);
      setToken(session.token);
      setUser(session.user);
      await AsyncStorage.multiSet([
        [SESSION_TOKEN_STORAGE_KEY, session.token],
        [SESSION_USER_STORAGE_KEY, JSON.stringify(session.user)],
      ]);
      return session;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(
    async (input: { username: string; email: string; password: string; nickname: string }) => {
      setLoading(true);
      try {
        return await flownoteApi.register({
          username: input.username.trim(),
          email: input.email.trim(),
          password: input.password,
          nickname: input.nickname.trim(),
        });
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    void AsyncStorage.multiRemove([SESSION_TOKEN_STORAGE_KEY, SESSION_USER_STORAGE_KEY]);
  }, []);

  const value = useMemo(
    () => ({ token, user, loading, login, register, logout }),
    [loading, login, logout, register, token, user]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useSession must be used inside SessionProvider.');
  }

  return value;
}
