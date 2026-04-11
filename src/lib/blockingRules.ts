/**
 * Productivity blocking rules.
 * A rule says: "when an event is on Calendar A, create a block on Calendar B
 * with the specified level of detail."
 *
 * Detail levels:
 *   busy        → creates a plain "Busy" block (no title leaked)
 *   focus_time  → creates a "Focus Time" block
 *   full_details → copies title, description, location
 */

import { refreshPrimaryToken, createCalendarEventWithToken, deleteCalendarEventWithToken } from './googleCalendar'
import { getGoogleToken } from './tokenManager'
import { loadAccounts } from './multiAccount'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DetailLevel = 'busy' | 'focus_time' | 'full_details'

export interface BlockingRule {
  id:                   string
  enabled:              boolean
  sourceCalendarId:     string
  sourceCalendarName:   string
  sourceAccountEmail:   string
  targetCalendarId:     string
  targetCalendarName:   string
  targetAccountEmail:   string
  detailLevel:          DetailLevel
}

/** Map of { ruleId → { sourceEventId → createdTargetEventId } } */
export type AppliedBlocksMap = Record<string, Record<string, string>>

// ─── Storage ─────────────────────────────────────────────────────────────────

const RULES_KEY   = 'cal-blocking-rules'
const APPLIED_KEY = 'cal-blocking-applied'

export function loadBlockingRules(): BlockingRule[] {
  try { return JSON.parse(localStorage.getItem(RULES_KEY) ?? '[]') } catch { return [] }
}
export function saveBlockingRules(rules: BlockingRule[]): void {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules))
}

function loadApplied(): AppliedBlocksMap {
  try { return JSON.parse(localStorage.getItem(APPLIED_KEY) ?? '{}') } catch { return {} }
}
function saveApplied(map: AppliedBlocksMap): void {
  localStorage.setItem(APPLIED_KEY, JSON.stringify(map))
}

// ─── Calendar cache helper ────────────────────────────────────────────────────

export interface CachedCalEntry {
  id: string
  summary?: string
  backgroundColor?: string
  accountEmail: string
}
export function loadCachedCalendars(): CachedCalEntry[] {
  try { return JSON.parse(localStorage.getItem('cal-intel-cals-cache') ?? '[]') } catch { return [] }
}

// ─── Token helper ─────────────────────────────────────────────────────────────

async function getToken(accountEmail: string): Promise<string | null> {
  const accounts = loadAccounts()
  const acct = accounts.find(a => a.email === accountEmail)
  if (acct?.isPrimary) {
    await refreshPrimaryToken()
    return localStorage.getItem('google_provider_token') || null
  }
  return getGoogleToken(accountEmail)
}

// ─── Rule application ─────────────────────────────────────────────────────────

export interface SourceEvent {
  id:          string
  calendarId:  string
  summary?:    string
  description?: string
  location?:   string
  start:       { dateTime?: string; date?: string; timeZone?: string }
  end:         { dateTime?: string; date?: string; timeZone?: string }
}

export interface ApplyResult {
  created: number
  skipped: number
  failed:  number
  errors:  string[]
}

/** Apply all enabled rules for the given source events. Creates blocks in target calendars. */
export async function applyBlockingRules(
  rules: BlockingRule[],
  sourceEvents: SourceEvent[],
): Promise<ApplyResult> {
  const applied = loadApplied()
  const result: ApplyResult = { created: 0, skipped: 0, failed: 0, errors: [] }

  for (const rule of rules) {
    if (!rule.enabled) continue

    const ruleApplied = applied[rule.id] ?? {}
    const matching = sourceEvents.filter(e => e.calendarId === rule.sourceCalendarId)

    for (const ev of matching) {
      // Already created a block for this event under this rule
      if (ruleApplied[ev.id]) { result.skipped++; continue }

      // All-day events: skip (no start.dateTime)
      if (!ev.start.dateTime) { result.skipped++; continue }

      const token = await getToken(rule.targetAccountEmail)
      if (!token) {
        result.failed++
        result.errors.push(`No token for ${rule.targetAccountEmail}`)
        continue
      }

      const blockEvent = buildBlockEvent(ev, rule.detailLevel)
      const { event, error } = await createCalendarEventWithToken(
        token, rule.targetCalendarId, blockEvent
      )

      if (event) {
        ruleApplied[ev.id] = event.id
        result.created++
      } else {
        result.failed++
        if (error) result.errors.push(error)
      }
    }

    applied[rule.id] = ruleApplied
  }

  saveApplied(applied)
  return result
}

/** Remove previously created blocks that no longer have a corresponding source event. */
export async function cleanupStaleBlocks(
  rules: BlockingRule[],
  currentSourceEvents: SourceEvent[],
): Promise<number> {
  const applied  = loadApplied()
  const currentIds = new Set(currentSourceEvents.map(e => e.id))
  let removed = 0

  for (const rule of rules) {
    if (!rule.enabled) continue
    const ruleApplied = applied[rule.id] ?? {}
    const token = await getToken(rule.targetAccountEmail)
    if (!token) continue

    for (const [sourceId, targetId] of Object.entries(ruleApplied)) {
      if (!currentIds.has(sourceId)) {
        const ok = await deleteCalendarEventWithToken(token, rule.targetCalendarId, targetId)
        if (ok) {
          delete ruleApplied[sourceId]
          removed++
        }
      }
    }
    applied[rule.id] = ruleApplied
  }

  saveApplied(applied)
  return removed
}

// ─── Event builder ────────────────────────────────────────────────────────────

function buildBlockEvent(
  source: SourceEvent,
  level: DetailLevel,
) {
  const base = {
    start: source.start,
    end:   source.end,
  }

  if (level === 'busy') {
    return { ...base, summary: 'Busy' }
  }

  if (level === 'focus_time') {
    return {
      ...base,
      summary:     'Focus Time',
      description: `Blocked from ${source.summary ?? 'another calendar'}`,
    }
  }

  // full_details
  return {
    ...base,
    summary:     source.summary,
    description: source.description,
    location:    source.location,
  }
}
