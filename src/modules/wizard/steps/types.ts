import type { FC, ReactNode } from 'react'
import type { WizardState } from '../state'

export type SetWizard = (patch: Partial<WizardState> | ((w: WizardState) => Partial<WizardState>)) => void

/** What every step's body is handed. */
export interface StepCtx {
  w: WizardState
  set: SetWizard
  /** A dry run (the admin's test): nothing a step does may leave the page. */
  dry: boolean
  /** Called just before a step sends the person away (an OAuth redirect), so the wizard can come back to where it was. */
  beforeOAuth: () => void
}

export interface StepDef {
  title: (w: WizardState) => ReactNode
  intro: string
  Body: FC<StepCtx>
  /** The primary button's words. Optional steps say "Save and continue". */
  continueLabel?: string
  /** Disabled while this says no — and says why, under the button. */
  blocker?: (w: WizardState) => string | null
  /** A step that can be left without answering says so here. */
  skipLabel?: string
}
