/**
 * The eight steps, in one list. The top bar, the progress, the shell's footer
 * and the Done summary all read this, so a step cannot be in one and missing
 * from another. 4 to 7 are optional: they can be skipped, and a skipped step
 * writes nothing.
 */
export type StepId = 'you' | 'accounts' | 'ai' | 'rhythm' | 'automation' | 'habits' | 'finance' | 'done'

export interface StepMeta {
  id: StepId
  /** In the top bar. */
  nav: string
  /** In the summary. */
  label: string
  optional: boolean
  /** How long it takes, said once under the title. */
  time: string
}

export const STEPS: StepMeta[] = [
  { id: 'you',        nav: '01 You',        label: 'You',                optional: false, time: '20 seconds' },
  { id: 'accounts',   nav: '02 Accounts',   label: 'Accounts',           optional: false, time: '40 seconds' },
  { id: 'ai',         nav: '03 AI key',     label: 'AI key',             optional: false, time: '30 seconds' },
  { id: 'rhythm',     nav: '04 Rhythm',     label: 'Rhythm',             optional: true,  time: 'optional' },
  { id: 'automation', nav: '05 Automation', label: 'Automation',         optional: true,  time: 'optional' },
  { id: 'habits',     nav: '06 Habits',     label: 'Habits and tasks',   optional: true,  time: 'optional' },
  { id: 'finance',    nav: '07 Finance',    label: 'Finance',            optional: true,  time: 'optional' },
  { id: 'done',       nav: '08 Done',       label: 'Done',               optional: false, time: 'all set' },
]

export const LAST = STEPS.length - 1
