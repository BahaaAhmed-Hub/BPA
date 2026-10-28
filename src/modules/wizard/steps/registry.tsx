import { Hl } from '../ui'
import { YouStep } from './YouStep'
import { AccountsStep } from './AccountsStep'
import { AiStep, aiBlocker } from './AiStep'
import { RhythmStep } from './RhythmStep'
import { AutomationStep } from './AutomationStep'
import { HabitsStep } from './HabitsStep'
import { FinanceStep, financeBlocker } from './FinanceStep'
import { DoneStep } from './DoneStep'
import type { StepDef } from './types'
import type { StepId } from '../steps'

export const DEFS: Record<StepId, StepDef> = {
  you: { title: () => <>Begin with <Hl>you.</Hl></>, intro: 'Your name and look appear on the laptop, a live picture of your app. Change them and watch it update.', Body: YouStep },
  accounts: { title: () => <>Bring your <Hl>world</Hl> in.</>, intro: 'Accounts feed your mail and calendar. A company gives its mail, tasks and events one color, everywhere.', Body: AccountsStep },
  ai: { title: () => <>Wake your <Hl>assistant.</Hl></>, intro: 'The morning brief, drafted replies and the assistant run on your own AI key. It lives on your account, never in the app.', Body: AiStep, blocker: aiBlocker, skipLabel: 'Skip for now' },
  rhythm: { title: () => <>Set your <Hl>rhythm.</Hl></>, intro: 'Work lands inside your working hours. Alerts wait outside them. Drag the sliders and watch the day reshape.', Body: RhythmStep, continueLabel: 'Save and continue', skipLabel: 'Skip this step' },
  automation: { title: () => <>Let the app do the <Hl>chores.</Hl></>, intro: 'Switch on the helpers you want, and choose which should tap your shoulder.', Body: AutomationStep, continueLabel: 'Save and continue', skipLabel: 'Skip this step' },
  habits: { title: () => <>Give the routine a <Hl>start.</Hl></>, intro: 'Pick a few habits to track. Your tasks come in sorted for you.', Body: HabitsStep, continueLabel: 'Save and continue', skipLabel: 'Skip this step' },
  finance: { title: () => <>Money, kept <Hl>private.</Hl></>, intro: 'Finance tracks your budget and where it goes. It is the one part of the app only you can read.', Body: FinanceStep, blocker: financeBlocker, continueLabel: 'Save and continue', skipLabel: 'Skip this step' },
  done: { title: w => { const n = w.name.trim().split(/\s+/)[0]; return n ? <>You are ready, <Hl>{n}</Hl>.</> : <>You are <Hl>ready.</Hl></> }, intro: 'Everything you set up is live. Nothing here is locked in.', Body: DoneStep },
}
