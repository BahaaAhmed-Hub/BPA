import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIState {
  sidebarCollapsed: boolean
  activeModule: string
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  setActiveModule: (module: string) => void
}

export const useUIStore = create<UIState>()(
  persist(
    set => ({
      sidebarCollapsed: false,
      activeModule: 'dashboard',
      toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v: boolean) => set({ sidebarCollapsed: v }),
      setActiveModule: module => set({ activeModule: module }),
    }),
    { name: 'professor-ui' },
  ),
)
