import { User, Clock, Building2, Flame, Brain, Bell, Palette, Link, Shield, CheckSquare, Zap, CreditCard, Sparkles, Wallet, Library as LibraryIcon } from 'lucide-react'
import { ls } from './model'

const SECTION_IDS = ['profile','billing','schedule','companies','habits','tasks','accounts','professor','automation','notifications','appearance','blocking','behavioral','finance','library'] as const
export type SectionId = typeof SECTION_IDS[number]

interface SectionMeta { id: SectionId; title: string; icon: React.ElementType; description: string }
export const SECTION_META: SectionMeta[] = [
  { id: 'profile',       title: 'Profile',              icon: User,        description: 'Who you are, and how the app plans your week' },
  { id: 'billing',       title: 'Billing',              icon: CreditCard,  description: 'Plan, payment method and invoices' },
  { id: 'accounts',      title: 'Accounts & companies', icon: Building2,   description: 'Connected Google accounts, and the companies that use them' },
  { id: 'professor',     title: 'AI',                   icon: Sparkles,    description: 'Which model answers, how far it may act, and how it sounds' },
  { id: 'schedule',      title: 'Schedule',             icon: Clock,       description: 'Focus hours, buffers, calendar blocking and sync rules' },
  { id: 'blocking',      title: 'Integrations',         icon: Link,        description: 'The tools that already hold your work' },
  { id: 'tasks',         title: 'Tasks',                icon: CheckSquare, description: 'Defaults, board statuses and task types' },
  { id: 'habits',        title: 'Habits',               icon: Flame,       description: 'Configure daily habits — synced with the Habits page' },
  { id: 'automation',    title: 'Automation',           icon: Zap,         description: 'Rules that run without asking you first' },
  { id: 'notifications', title: 'Notifications',        icon: Bell,        description: 'What reaches you, where, and when it stays quiet' },
  { id: 'appearance',    title: 'Appearance',           icon: Palette,     description: 'The accent colour, theme, and how much fits on screen' },
  { id: 'behavioral',    title: 'Behavioral OS',        icon: Brain,       description: 'Rank scoring, operating mode and tone' },
  { id: 'companies',     title: 'Data & privacy',       icon: Shield,      description: 'Where your data sits, what leaves it, and how to take it with you' },
  { id: 'finance',       title: 'Finance',              icon: Wallet,      description: 'Envelope style, figures, dates & alerts' },
  { id: 'library',       title: 'Library',              icon: LibraryIcon, description: 'Turn the book shelf on or off, and what it holds' },
]

/** Words people look for that the title and the one-line description do not
 *  carry — "calendar" is a setting on three pages and a title on none. */
export const SEARCH_KEYWORDS: Partial<Record<SectionId, string>> = {
  profile:       'name timezone week start work days sign out',
  billing:       'plan upgrade subscription invoice payment card',
  companies:     'export download delete account privacy analytics crash danger zone',
  accounts:      'google gmail calendar drive companies people connect',
  blocking:      'notion asana trello apple notes telegram siri mcp token',
  schedule:      'calendar blocking sync rules how often focus window meeting buffer travel family time end of day hours',
  tasks:         'board statuses columns types default view hide completed done default calendar framework time blocking eisenhower gtd',
  habits:        'daily streak tracker',
  library:       'books shelf quotes reading',
  finance:       'budget envelope money currency ledger lock password',
  professor:     'ai assistant claude groq model api key voice tone autonomy behavioral os rank mode samurai',
  automation:    'rules morning brief draft replies roll forward newsletters',
  appearance:    'theme accent colour color dark density compact',
  notifications: 'push alerts quiet hours digest',
}

/** The rail. Behavioral OS has no entry of its own: it is a block on the AI page. */
export const NAV_GROUPS: { label: string; ids: SectionId[] }[] = [
  { label: 'Account',      ids: ['profile', 'billing', 'companies'] },
  { label: 'Workspace',    ids: ['accounts', 'blocking', 'schedule', 'tasks'] },
  { label: 'Life',         ids: ['habits', 'finance', 'library'] },
  { label: 'Intelligence', ids: ['professor', 'automation'] },
  { label: 'Preferences',  ids: ['appearance', 'notifications'] },
]

/** A section id that is drawn as part of another page. The palette and the
 *  budget screen still store these ids in `settings-active-section`. */
const PAGE_OF: Partial<Record<SectionId, SectionId>> = { behavioral: 'professor' }
export function pageFor(id: SectionId): SectionId { return PAGE_OF[id] ?? id }

/** The group a section lives in, so a link into a folded group can open it. */
export function groupOf(id: SectionId): string | undefined {
  const page = pageFor(id)
  return NAV_GROUPS.find(g => g.ids.includes(page))?.label
}

/** Groups folded the first time Settings opens. */
export const DEFAULT_CLOSED_GROUPS = ['Preferences']

export function isSectionId(v: unknown): v is SectionId {
  return typeof v === 'string' && (SECTION_IDS as readonly string[]).includes(v)
}

export function loadSectionOrder(): SectionId[] {
  const saved = ls<SectionId[]>('professor-section-order', [])
  const valid = saved.filter(id => (SECTION_IDS as readonly string[]).includes(id))
  const miss  = SECTION_IDS.filter(id => !valid.includes(id))
  // Pinned new feature sections get prepended so they're immediately visible
  const pinnedNew = miss.filter(id => id === 'behavioral')
  const otherNew  = miss.filter(id => id !== 'behavioral')
  return [...pinnedNew, ...valid, ...otherNew]
}
