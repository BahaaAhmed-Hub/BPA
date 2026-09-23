import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_THEME_ID } from '@/lib/themes'
import { moduleIsOff, labelOf } from '@/lib/entitlements'
import { notify } from '@/lib/undo'

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
      // Every way into a module comes through here — the nav, the palette,
      // Today's shortcuts, a task's calendar row, the sidebar. Gating the one
      // door covers the ways in nobody has thought of yet; gating each caller
      // covers the ones somebody remembered. A refusal *says why*, because a
      // button that silently does nothing is the thing this is fixing.
      setActiveModule: module => {
        if (moduleIsOff(module)) return notify(`${labelOf(module)} is not on your plan`)
        set({ activeModule: module })
      },
      setThemeId: (id: string) => set({ themeId: id }),
      focusOn: target => {
        if (moduleIsOff(target.module)) return notify(`${labelOf(target.module)} is not on your plan`)
        set({ focus: target, activeModule: target.module })
      },
      clearFocus: () => set({ focus: null }),
    }),
    {
      name: 'professor-ui',
      // A focus target is for the next render, not for the next session
      partialize: s => ({ sidebarCollapsed: s.sidebarCollapsed, activeModule: s.activeModule, themeId: s.themeId }),
    },
  ),
)
