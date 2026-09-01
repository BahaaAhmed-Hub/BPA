import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_THEME_ID } from '@/lib/themes'

/** What a module should open with when something sends you to it. */
export interface FocusTarget {
  module: string
  /** Event id or task id, depending on the module. */
  id: string
  /** The day to land on, for the calendar. */
  date?: string
}

interface UIState {
  sidebarCollapsed: boolean
  activeModule: string
  themeId: string
  focus: FocusTarget | null
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  setActiveModule: (module: string) => void
  setThemeId: (id: string) => void
  /** Send the user to a module with one thing already open. */
  focusOn: (target: FocusTarget) => void
  clearFocus: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    set => ({
      sidebarCollapsed: false,
      activeModule: 'dashboard',
      themeId: DEFAULT_THEME_ID,
      focus: null,
      toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v: boolean) => set({ sidebarCollapsed: v }),
      setActiveModule: module => set({ activeModule: module }),
      setThemeId: (id: string) => set({ themeId: id }),
      focusOn: target => set({ focus: target, activeModule: target.module }),
      clearFocus: () => set({ focus: null }),
    }),
    {
      name: 'professor-ui',
      // A focus target is for the next render, not for the next session
      partialize: s => ({ sidebarCollapsed: s.sidebarCollapsed, activeModule: s.activeModule, themeId: s.themeId }),
    },
  ),
)
