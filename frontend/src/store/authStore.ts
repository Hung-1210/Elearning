import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthPayload } from '../types';

interface AuthState {
  user: AuthPayload | null;
  accessToken: string | null;
  isAuthenticated: boolean;

  setAuth: (user: AuthPayload, token: string) => void;
  setAccessToken: (token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,

      setAuth: (user, accessToken) =>
        set({ user, accessToken, isAuthenticated: true }),

      setAccessToken: (accessToken) =>
        set({ accessToken }),

      logout: () =>
        set({ user: null, accessToken: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
      // Only persist user info, NOT the access token (security)
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
