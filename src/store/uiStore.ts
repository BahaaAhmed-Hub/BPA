import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_THEME_ID } from '@/lib/themes'

interface UIState {
  sidebarCollapsed: boolean
  activeModule: string
  themeId: string
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  setActiveModule: (module: string) => void
  setThemeId: (id: string) => void
}

export const useUIStore = create<UIState>()(
  persist(
    set => ({
      sidebarCollapsed: false,
      activeModule: 'dashboard',
      themeId: DEFAULT_THEME_ID,
      toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v: boolean) => set({ sidebarCollapsed: v }),
      setActiveModule: module => set({ activeModule: module }),
      setThemeId: (id: string) => set({ themeId: id }),
    }),
    { name: 'professor-ui' },
  ),
)
