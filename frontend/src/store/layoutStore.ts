import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark';

function applyDomTheme(theme: ThemeMode) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

interface LayoutState {
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  theme: ThemeMode;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  toggleMobileSidebar: () => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      theme: 'light',
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      openMobileSidebar: () => set({ mobileSidebarOpen: true }),
      closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
      toggleMobileSidebar: () =>
        set((state) => ({ mobileSidebarOpen: !state.mobileSidebarOpen })),
      setTheme: (theme) => {
        applyDomTheme(theme);
        set({ theme });
      },
      toggleTheme: () =>
        set((state) => {
          const next: ThemeMode = state.theme === 'dark' ? 'light' : 'dark';
          applyDomTheme(next);
          return { theme: next };
        }),
    }),
    {
      name: 'layout-storage',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          applyDomTheme(state.theme);
        }
      },
    },
  ),
);
