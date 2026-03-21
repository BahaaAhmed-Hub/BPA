import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  loading: boolean
  setUser: (user: User | null) => void
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    set => ({
      user: null,
      loading: true,
      setUser: user => set({ user }),
      setLoading: loading => set({ loading }),
    }),
    {
      name: 'professor-auth',
      partialize: state => ({ user: state.user }), // only persist user, not loading
    },
  ),
)
