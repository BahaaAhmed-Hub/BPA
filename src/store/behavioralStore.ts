import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type BehavioralMode = 'samurai' | 'pharaoh' | 'astral'
export type Rank = 'ronin' | 'samurai' | 'daimyo' | 'shogun'
export type IdentityStage = 'emerging' | 'developing' | 'established' | 'core'

export interface IdentityResult {
  id: string
  name: string
  emoji: string
  stage: IdentityStage
  score: number
  description: string
  detectedAt: string
}

export interface RankResult {
  rank: Rank
  score: number
  components: {
    taskCompletion: number
    habitConsistency: number
    planningQuality: number
  }
}

export interface BehavioralState {
  enabled: boolean
  mode: BehavioralMode

  // Cached evaluation results (refreshed on demand)
  cachedRank: RankResult | null
  cachedIdentities: IdentityResult[]
  cachedInsights: string[]
  lastEvaluated: string | null

  // Actions
  setEnabled: (v: boolean) => void
  setMode: (m: BehavioralMode) => void
  setEvaluation: (rank: RankResult, identities: IdentityResult[], insights: string[]) => void
}

export const useBehavioralStore = create<BehavioralState>()(
  persist(
    set => ({
      enabled: false,
      mode: 'samurai',
      cachedRank: null,
      cachedIdentities: [],
      cachedInsights: [],
      lastEvaluated: null,

      setEnabled: (v) => set({ enabled: v }),
      setMode:    (m) => set({ mode: m }),
      setEvaluation: (rank, identities, insights) =>
        set({ cachedRank: rank, cachedIdentities: identities, cachedInsights: insights, lastEvaluated: new Date().toISOString() }),
    }),
    { name: 'professor-behavioral' },
  ),
)
