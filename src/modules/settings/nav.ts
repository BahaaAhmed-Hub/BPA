import { User, Clock, Building2, Flame, Brain, Bell, Palette, Link, Shield, Hash, CheckSquare, Swords, CreditCard, Library as LibraryIcon } from 'lucide-react'
import { AssistantNavIcon } from './ui'
import { ls } from './model'

const SECTION_IDS = ['profile','billing','schedule','companies','habits','tasks','accounts','professor','automation','notifications','appearance','blocking','behavioral','finance','library'] as const
export type SectionId = typeof SECTION_IDS[number]

interface SectionMeta { id: SectionId; title: string; icon: React.ElementType; description: string }
export const SECTION_META: SectionMeta[] = [
  { id: 'profile',       title: 'Profile',              icon: User,        description: 'Name, timezone, work week & framework' },
  { id: 'billing',       title: 'Billing',              icon: CreditCard,  description: 'Plan, payment method and invoices' },
  { id: 'accounts',      title: 'Accounts & companies', icon: Building2,   description: 'Connected Google accounts, and the companies that use them' },
  { id: 'professor',     title: 'AI',                   icon: AssistantNavIcon, description: 'Its name, model, autonomy and what the assistant may write for you' },
  { id: 'schedule',      title: 'Schedule rules',       icon: Clock,       description: 'Focus hours, buffers, meeting protections' },
  { id: 'blocking',      title: 'Integrations',         icon: Link,        description: 'Notion, Asana, Trello, Apple Notes and calendar sync' },
  { id: 'tasks',         title: 'Tasks',                icon: CheckSquare, description: 'Board statuses and task types' },
  { id: 'habits',        title: 'Habits',               icon: Flame,       description: 'Configure daily habits — synced with Habits page' },
  { id: 'automation',    title: 'Automation',           icon: Swords,      description: 'Rules that run without asking you first' },
  { id: 'notifications', title: 'Notifications',        icon: Bell,        description: 'What reaches you, where, and when it stays quiet' },
  { id: 'appearance',    title: 'Appearance',           icon: Palette,     description: 'The accent colour, and how much fits on screen' },
  { id: 'behavioral',    title: 'Behavioral OS',        icon: Brain,       description: 'Rank scoring, operating mode and tone' },
  { id: 'companies',     title: 'Data & privacy',       icon: Shield,      description: 'Where your data sits and how long it stays' },
  { id: 'finance',       title: 'Finance',              icon: Hash,        description: 'Envelope style, figures, dates & alerts' },
  { id: 'library',       title: 'Library',              icon: LibraryIcon, description: 'Turn the book shelf on or off, and what it holds' },
]

// Grouped nav — matches 11A Sunlit Bento design
export const NAV_GROUPS: { label: string; ids: SectionId[] }[] = [
  { label: 'YOU',       ids: ['profile', 'billing'] },
  { label: 'WORKSPACE', ids: ['accounts', 'professor', 'schedule', 'blocking'] },
  { label: 'WORK',      ids: ['tasks', 'habits', 'library'] },
  { label: 'SYSTEM',    ids: ['automation', 'notifications', 'appearance', 'behavioral', 'companies', 'finance'] },
]
export function loadSectionOrder(): SectionId[] {
  const saved = ls<SectionId[]>('professor-section-order', [])
  const valid = saved.filter(id => (SECTION_IDS as readonly string[]).includes(id))
  const miss  = SECTION_IDS.filter(id => !valid.includes(id))
  // Pinned new feature sections get prepended so they're immediately visible
  const pinnedNew = miss.filter(id => id === 'behavioral')
  const otherNew  = miss.filter(id => id !== 'behavioral')
  return [...pinnedNew, ...valid, ...otherNew]
}
