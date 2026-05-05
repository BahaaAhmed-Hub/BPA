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
  autoApply:            boolean
  hideBlocked:          boolean   // hide created blocks from Cal Intel view
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

export function loadApplied(): AppliedBlocksMap {
  try { return JSON.parse(localStorage.getItem(APPLIED_KEY) ?? '{}') } catch { return {} }
}
export function saveApplied(map: AppliedBlocksMap): void {
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
  const accounts     = loadAccounts()
  const acct         = accounts.find(a => a.email === accountEmail)
  // Use GoTrue path for the primary account.
  // Also fall back to google_primary_email — covers the case where
  // professor-connected-accounts was cleared (e.g. after sign-in) so
  // loadAccounts() returns [] and acct is undefined, which would otherwise
  // call getGoogleToken() with the primary email, dispatching
  // cal:reconnect-required and showing error badges on all primary calendars.
  const primaryEmail = localStorage.getItem('google_primary_email')
  if (acct?.isPrimary || accountEmail === primaryEmail) {
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

// Concurrency guard — prevents duplicate blocks from concurrent auto+manual runs
let applyInProgress = false

/** Apply all enabled rules for the given source events. Creates blocks in target calendars. */
export async function applyBlockingRules(
  rules: BlockingRule[],
  sourceEvents: SourceEvent[],
): Promise<ApplyResult> {
  if (applyInProgress) return { created: 0, skipped: 0, failed: 0, errors: ['Apply already in progress'] }
  applyInProgress = true

  const applied = loadApplied()
  const result: ApplyResult = { created: 0, skipped: 0, failed: 0, errors: [] }

  try {
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

        const blockEvent = buildBlockEvent(ev, rule)
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
  } finally {
    applyInProgress = false
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

/** Hidden marker embedded in every created block so we can detect cross-device duplicates. */
function dedupMarker(ruleId: string, sourceId: string) {
  return `\n[bpa-block:${ruleId}:${sourceId}]`
}

function buildBlockEvent(source: SourceEvent, rule: BlockingRule) {
  const marker = dedupMarker(rule.id, source.id)
  const base   = { start: source.start, end: source.end }

  if (rule.detailLevel === 'busy') {
    return { ...base, summary: 'Busy', description: marker.trim() }
  }

  if (rule.detailLevel === 'focus_time') {
    return {
      ...base,
      summary:     'Focus Time',
      description: `Blocked from ${source.summary ?? 'another calendar'}${marker}`,
    }
  }

  // full_details
  return {
    ...base,
    summary:     source.summary ?? 'Busy',
    description: (source.description ? source.description + marker : marker.trim()),
    location:    source.location,
  }
}
