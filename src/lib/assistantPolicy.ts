// ─── What the assistant may do without asking ────────────────────────────────
//
//  The assistant acts as the signed-in person, on their own data (every call is
//  made with their own tokens and their own rows). That is the *scope*. This
//  file is the *consent*: three kinds of act are never done on the model's say-so
//  alone, because each is either seen by other people, cannot be taken back, or
//  moves money.
//
//    outward      other people see or are told  — mail, replies, RSVPs
//    destructive  cannot be undone              — any delete / remove
//    money        changes the ledger            — entries, goals, rates, envelopes
//
//  It is enforced in code, between the model's request and the tool: the panel
//  shows what is about to happen with its real arguments and waits for a click.
//  A line in the prompt is a request to the model; this is not.

export type ApprovalKind = 'outward' | 'destructive' | 'money'

export interface Approval {
  kind: ApprovalKind
  /** One line: what is about to happen. */
  title: string
  /** The call's real arguments, so what is shown is what will be done. */
  lines: { label: string; value: string }[]
}

const OUTWARD = new Set(['send_email', 'reply_to_email', 'rsvp_invitation'])
const MONEY = new Set(['add_transaction', 'update_transaction', 'set_transaction_paid', 'add_goal', 'update_goal', 'set_exchange_rate', 'set_budget_envelope'])

const TITLES: Record<string, string> = {
  send_email: 'Send an email',
  reply_to_email: 'Send a reply',
  rsvp_invitation: 'Answer an invitation — the organiser is told',
  update_calendar_event: 'Change an event — its guests are told',
}

const words = (s: string) => s.replace(/_/g, ' ')
const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n)}…` : s)
const show = (v: unknown): string => {
  if (typeof v === 'string') return clip(v)
  if (v === null || v === undefined) return ''
  try { return clip(JSON.stringify(v)) } catch { return clip(String(v)) }
}

/** `null` when the call needs no approval. */
export function approvalFor(name: string, input: Record<string, unknown>): Approval | null {
  let kind: ApprovalKind | null = null
  if (OUTWARD.has(name) || (name === 'update_calendar_event' && input.confirm_notify_guests === true)) kind = 'outward'
  else if (/(^|_)(delete|remove)_/.test(name)) kind = 'destructive'
  else if (MONEY.has(name)) kind = 'money'
  if (!kind) return null

  const title = TITLES[name]
    ?? (kind === 'destructive' ? `Delete — ${words(name.replace(/^.*?(delete|remove)_/, ''))}` : `Change your finances — ${words(name)}`)
  const lines = Object.entries(input)
    // `confirm` is the model telling a tool it is sure; the person's click is the confirmation that counts.
    .filter(([k, v]) => k !== 'confirm' && v !== undefined && v !== null && v !== '')
    .slice(0, 8)
    .map(([k, v]) => ({ label: words(k), value: show(v) }))
  return { kind, title, lines }
}

/** What the model is told when the person says no, so it does not argue or retry. */
export const DECLINED = {
  declined: true,
  message: 'The user did not approve this action, so nothing was done. Do not try it again or find another way to do it; say it was not done and ask what they would like instead.',
} as const
