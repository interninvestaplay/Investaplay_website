import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  api,
  getStoredToken,
  getStoredUser,
  setStoredToken,
  setStoredUser,
  clearAllStoredAuth,
} from '../services/api';
import { getSocket, closeSocket } from '../services/socket';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (payload: { username?: string; email?: string; password: string }) => Promise<void>;
  signup: (payload: { username: string; email: string; password: string; displayName?: string }) => Promise<void>;
  guestLogin: (displayName?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateCoins: (newAmount: number) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [user, setUser] = useState<User | null>(getStoredUser());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const logout = () => {
    clearAllStoredAuth();
    setToken(null);
    setUser(null);
    closeSocket();
  };

  const refreshUser = async () => {
    try {
      if (!getStoredToken()) return;
      const res = await api.me();
      if (res.user) {
        setUser(res.user);
        setStoredUser(res.user);
      }
    } catch (err: any) {
      console.warn('[AuthContext] Failed to refresh user profile:', err);
      if (err.status === 401 || String(err.message || '').toLowerCase().includes('token')) {
        logout();
      }
    }
  };

  useEffect(() => {
    const handleExpired = () => {
      logout();
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      if (token) {
        await refreshUser();
        getSocket();
      }
      setIsLoading(false);
    };
    initAuth();
  }, [token]);

  const login = async (payload: { username?: string; email?: string; password: string }) => {
    const res = await api.login(payload);
    setToken(res.accessToken);
    setUser(res.user);
    getSocket();
  };

  const signup = async (payload: { username: string; email: string; password: string; displayName?: string }) => {
    const res = await api.signup(payload);
    setToken(res.accessToken);
    setUser(res.user);
    getSocket();
  };

  const guestLogin = async (displayName?: string) => {
    const res = await api.guestLogin(displayName);
    setToken(res.accessToken);
    setUser(res.user);
    getSocket();
  };

  const updateCoins = (newAmount: number) => {
    if (user) {
      const updated = { ...user, coins: newAmount };
      setUser(updated);
      setStoredUser(updated);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        signup,
        guestLogin,
        logout,
        refreshUser,
        updateCoins,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
