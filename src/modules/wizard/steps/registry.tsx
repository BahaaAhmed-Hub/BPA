import { Hl } from '../ui'
import type { StepDef } from './types'
import type { StepId } from '../steps'

const Soon = () => <p className="wz-note">This step is being built.</p>

export const DEFS: Record<StepId, StepDef> = {
  you: { title: () => <>Begin with <Hl>you.</Hl></>, intro: 'Your name and look appear on the laptop, a live picture of your app. Change them and watch it update.', Body: Soon },
  accounts: { title: () => <>Bring your <Hl>world</Hl> in.</>, intro: 'Accounts feed your mail and calendar. A company gives its mail, tasks and events one color, everywhere.', Body: Soon },
  ai: { title: () => <>Wake your <Hl>assistant.</Hl></>, intro: 'The morning brief, drafted replies and the assistant run on your own AI key. It lives on your account, never in the app.', Body: Soon, skipLabel: 'Skip for now' },
  rhythm: { title: () => <>Set your <Hl>rhythm.</Hl></>, intro: 'Work lands inside your working hours. Alerts wait outside them. Drag the sliders and watch the day reshape.', Body: Soon, continueLabel: 'Save and continue', skipLabel: 'Skip this step' },
  automation: { title: () => <>Let the app do the <Hl>chores.</Hl></>, intro: 'Switch on the helpers you want, and choose which should tap your shoulder.', Body: Soon, continueLabel: 'Save and continue', skipLabel: 'Skip this step' },
  habits: { title: () => <>Give the routine a <Hl>start.</Hl></>, intro: 'Pick a few habits to track. Your tasks come in sorted for you.', Body: Soon, continueLabel: 'Save and continue', skipLabel: 'Skip this step' },
  finance: { title: () => <>Money, kept <Hl>private.</Hl></>, intro: 'Finance tracks your budget and where it goes. It is the one part of the app only you can read.', Body: Soon, continueLabel: 'Save and continue', skipLabel: 'Skip this step' },
  done: { title: w => <>You are ready, <Hl>{w.name.trim().split(/\s+/)[0] || 'there'}</Hl>.</>, intro: 'Everything you set up is live. Nothing here is locked in.', Body: Soon },
}
