/** People the calendar already knows — the guests and organisers of events that
 *  are loaded — ranked for the Attendees field's suggestions. Pure: no store,
 *  no network, so the ranking can be tested without a browser. */

export interface KnownPerson {
  email: string
  /** Google's display name when any event carried one, else ''. */
  name: string
  /** How many loaded events they are on — the ranking. */
  count: number
}

interface SourceEvent {
  attendees?: { email?: string; displayName?: string; self?: boolean }[]
  organizer?: { email?: string; displayName?: string; self?: boolean }
}

const norm = (e: string | undefined) => (e ?? '').trim().toLowerCase()

/** Most-shared first, then by name. `exclude` are addresses that must never be
 *  offered (the organiser, the people already invited). `self` rows are dropped:
 *  you are never your own guest. */
export function knownPeopleFrom(events: SourceEvent[], exclude: (string | undefined)[] = []): KnownPerson[] {
  const skip = new Set(exclude.map(norm).filter(Boolean))
  const seen = new Map<string, KnownPerson>()
  for (const ev of events) {
    const here = new Set<string>()
    const rows = [...(ev.attendees ?? []), ...(ev.organizer ? [ev.organizer] : [])]
    for (const r of rows) {
      const email = norm(r.email)
      if (!email || r.self || skip.has(email) || here.has(email)) continue
      // A resource calendar is a room, not a person.
      if (email.endsWith('@resource.calendar.google.com')) continue
      here.add(email)
      const cur = seen.get(email)
      if (cur) { cur.count++; if (!cur.name && r.displayName) cur.name = r.displayName }
      else seen.set(email, { email, name: r.displayName ?? '', count: 1 })
    }
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.email.localeCompare(b.email))
}

/** What the person has typed so far, matched against name and address. An empty
 *  query suggests nothing: a list under an empty field is noise. */
export function matchPeople(people: KnownPerson[], query: string, limit = 5): KnownPerson[] {
  const q = query.trim().toLowerCase().replace(/^@/, '')
  if (!q) return []
  return people
    .filter(p => p.email.includes(q) || p.name.toLowerCase().includes(q))
    .slice(0, limit)
}
