
import {
  LayoutDashboard,
  CheckSquare,
  Calendar,
  Inbox,
  Target,
  RefreshCw,
  Sun,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Settings,
  Swords,
  Crown,
  Sparkles,
  Compass,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

const MODE_ICONS: Record<string, LucideIcon> = {
  default: GraduationCap,
  samurai: Swords,
  pharaoh: Crown,
  astral:  Sparkles,
}

import { useUIStore } from '@/store/uiStore'
import { useBehavioralStore } from '@/store/behavioralStore'
import { ICON, STROKE } from '@/lib/type'
import { NavRow } from '@/components/ui'

const NAV_ITEMS = [
  { id: 'dashboard',  label: 'Dashboard',      Icon: LayoutDashboard },
  { id: 'tasks',      label: 'Task Command',    Icon: CheckSquare },
  { id: 'calendar',   label: 'Calendar Intel',  Icon: Calendar },
  { id: 'inbox',      label: 'Command Inbox',   Icon: Inbox },
  { id: 'habits',     label: 'Habits Tracker',  Icon: Target },
  { id: 'review',     label: 'Weekly Review',   Icon: RefreshCw },
  { id: 'morning',    label: 'Morning Brief',   Icon: Sun },
  { id: 'planning',   label: 'Planning',        Icon: Compass },
  { id: 'finance',    label: 'Finance',         Icon: Wallet },
]

const SYSTEM_ITEMS = [
  { id: 'settings', label: 'Settings', Icon: Settings },
]

export function Sidebar() {
  const { sidebarCollapsed, activeModule, toggleSidebar, setActiveModule } = useUIStore()
  const behavioralEnabled = useBehavioralStore(s => s.enabled)
  const behavioralMode    = useBehavioralStore(s => s.mode)

  return (
    <aside
      className="sb-blur-surface"
      style={{
        width: sidebarCollapsed ? 64 : 220,
        minWidth: sidebarCollapsed ? 64 : 220,
        background: 'var(--sb-header)',
        borderRight: `1px solid ${'var(--sb-border)'}`,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s ease, min-width 0.2s ease',
        position: 'sticky',
        top: 0,
        zIndex: 20,
        overflow: 'hidden',
      }}
    >
      {/* Logo — exact 64px height to align with TopBar */}
      <div
        style={{
          height: 64, flexShrink: 0,
          padding: sidebarCollapsed ? '0' : '0 20px',
          borderBottom: `1px solid ${'var(--sb-border)'}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
        }}
      >
        {(() => {
          const modeKey = behavioralEnabled ? behavioralMode : 'default'
          const LogoIcon = MODE_ICONS[modeKey] ?? GraduationCap
          // A behavioural mode moves `--sb-accent` itself (lib/themes.ts), so
          // the mark is drawn in the accent whatever mode it is — and its
          // glyph in whatever that accent takes, which on a dark accent is
          // pale rather than the card colour it used to assume.
          return (
            <div style={{
              width: 32, height: 32,
              background: 'var(--sb-accent)',
              borderRadius: 'var(--sb-r-chip)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 0.3s ease',
            }}>
              <LogoIcon size={ICON.lg} color="var(--sb-accent-ink)" strokeWidth={STROKE.active} />
            </div>
          )
        })()}
        {!sidebarCollapsed && (
          <span
            style={{
              fontFamily: 'var(--sb-font-num)',
              fontWeight: 700,
              fontSize: 'var(--sb-t-h3)',
              color: 'var(--sb-ink-1)',
              letterSpacing: '-0.3px',
              whiteSpace: 'nowrap',
            }}
          >
            The Professor
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1 }}>
          {NAV_ITEMS.map(({ id, label, Icon }) => {
            const active = activeModule === id
            return (
              <NavRow
                key={id}
                onClick={() => setActiveModule(id)}
                active={active}
                collapsed={sidebarCollapsed}
                Icon={Icon}
                label={label}
                style={{ marginBottom: 2 }}
              />
            )
          })}
        </div>

        {/* Behavioral OS — shown only when enabled */}
        {behavioralEnabled && (() => {
          const id = 'behavioral'
          const active = activeModule === id
          const modeLabel = behavioralMode === 'samurai' ? 'SAMURAI' : behavioralMode === 'pharaoh' ? 'PHARAOH' : 'ASTRAL'
          return (
            <div style={{ borderTop: `1px solid ${'var(--sb-border)'}`, paddingTop: 10, marginTop: 4 }}>
              {!sidebarCollapsed && (
                <span style={{
                  display: 'block', padding: '4px 12px 6px',
                  fontSize: 'var(--sb-t-micro)', fontWeight: 700, color: 'var(--sb-warning)',
                  textTransform: 'uppercase', letterSpacing: '1.2px',
                }}>
                  {modeLabel} MODE
                </span>
              )}
              <NavRow
                onClick={() => setActiveModule(id)}
                active={active}
                collapsed={sidebarCollapsed}
                Icon={Swords}
                label="Behavioral OS"
                style={{ marginBottom: 2 }}
              />
            </div>
          )
        })()}

        {/* System section */}
        <div style={{ borderTop: `1px solid ${'var(--sb-border)'}`, paddingTop: 10, marginTop: 4 }}>
          {!sidebarCollapsed && (
            <span style={{
              display: 'block', padding: '4px 12px 6px',
              fontSize: 'var(--sb-t-micro)', fontWeight: 700, color: 'var(--sb-warning)',
              textTransform: 'uppercase', letterSpacing: '1.2px',
            }}>
              System
            </span>
          )}
          {SYSTEM_ITEMS.map(({ id, label, Icon }) => {
            const active = activeModule === id
            return (
              <NavRow
                key={id}
                onClick={() => setActiveModule(id)}
                active={active}
                collapsed={sidebarCollapsed}
                Icon={Icon}
                label={label}
                style={{ marginBottom: 2 }}
              />
            )
          })}
        </div>
      </nav>

      {/* Collapse toggle */}
      <div style={{ padding: '12px 8px', borderTop: `1px solid ${'var(--sb-border)'}` }}>
        <button
          onClick={toggleSidebar}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarCollapsed ? 'center' : 'flex-end',
            padding: '8px 12px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--sb-ink-4)',
            borderRadius: 'var(--sb-r-chip)',
          }}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed
            ? <ChevronRight size={ICON.lg} />
            : <ChevronLeft size={ICON.lg} />
          }
        </button>
      </div>
    </aside>
  )
}
