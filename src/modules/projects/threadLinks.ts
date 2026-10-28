import type { Project, ProjectLink, ThreadMeta } from './types'

/** A mail thread's key in `project_links.ref_id`. A thread id is only unique
 *  inside one mailbox, so the mailbox is part of it — the same key mail's own
 *  marks use. */
export const threadRef = (accountEmail: string, threadId: string) => `${accountEmail}|${threadId}`

export interface ThreadLike {
  accountEmail: string
  threadId: string
  subject: string
  fromName: string
  fromEmail: string
  lastAt: number
}

export const threadMeta = (t: ThreadLike): ThreadMeta => ({
  subject: t.subject, fromName: t.fromName, fromEmail: t.fromEmail, at: t.lastAt, accountEmail: t.accountEmail,
})

export const sameThreadMeta = (a: unknown, b: ThreadMeta): boolean => {
  const m = a as Partial<ThreadMeta> | undefined
  return !!m && m.subject === b.subject && m.fromName === b.fromName && m.fromEmail === b.fromEmail
    && m.at === b.at && m.accountEmail === b.accountEmail
}

// ─── "Looks like Project X" ──────────────────────────────────────────────────
// Deterministic and explainable — no model, so it is instant, costs nothing and
// can say why. A label that is wrong some of the time is worse than none (the
// company chip's own rule), so it stays quiet unless exactly one project is the
// clear answer, and it only ever *offers*: nothing is linked without a press.

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export interface Suggestion { project: Project; reason: string; tier: 1 | 2 | 3 }

export function suggestProject(
  t: { subject: string; fromEmail: string },
  ref: string,
  projects: Project[],
  links: ProjectLink[],
  dismissed: ReadonlySet<string>,
): Suggestion | null {
  // A thread that already has a project needs no suggestion.
  if (links.some(l => l.kind === 'thread' && l.refId === ref)) return null
  const subject = ` ${norm(t.subject)} `
  const words = new Set(subject.trim().split(' '))
  const sender = t.fromEmail.trim().toLowerCase()
  const live = projects.filter(p => !p.archived && p.status !== 'done' && !dismissed.has(`${ref}|${p.id}`))

  const found: Suggestion[] = []
  for (const p of live) {
    const name = norm(p.name)
    // 1 — its whole name is in the subject.
    if (name.length >= 4 && subject.includes(` ${name} `)) { found.push({ project: p, reason: 'its name is in the subject', tier: 1 }); continue }
    // 2 — every distinctive word of a name of two or more is in it, in any order.
    const sig = name.split(' ').filter(w => w.length >= 4)
    if (sig.length >= 2 && sig.every(w => words.has(w))) { found.push({ project: p, reason: `the subject mentions ${sig.join(' and ')}`, tier: 2 }); continue }
    // 3 — the sender is on two or more threads already in this project, and on
    //     none in any other: one correspondent, one body of work.
    if (sender) {
      const bySender = (pid?: string) => links.filter(l => l.kind === 'thread' && (pid ? l.projectId === pid : l.projectId !== p.id)
        && (l.meta as { fromEmail?: string } | undefined)?.fromEmail?.toLowerCase() === sender).length
      if (bySender(p.id) >= 2 && bySender() === 0) found.push({ project: p, reason: `${sender} is on ${bySender(p.id)} threads in this project`, tier: 3 })
    }
  }
  if (!found.length) return null
  const best = Math.min(...found.map(f => f.tier))
  const top = found.filter(f => f.tier === best)
  // Two projects tie: that is a question, not an answer.
  return top.length === 1 ? top[0] : null
}

// What was said no to, per browser: a dismissed suggestion stays dismissed.
const DISMISS_KEY = 'project-suggest-dismissed'
export function loadDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]') as string[]) } catch { return new Set() }
}
export function dismissSuggestion(ref: string, projectId: string): void {
  const set = loadDismissed(); set.add(`${ref}|${projectId}`)
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...set].slice(-500))) } catch { /* quota */ }
}
