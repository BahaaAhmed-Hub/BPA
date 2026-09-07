
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

const MODE_ACCENT: Record<string, string> = {
  default: '',
  samurai: '#8B1A1A',
  pharaoh: '#C9A227',
  astral:  '#7C3AED',
}
import { useUIStore } from '@/store/uiStore'
import { useBehavioralStore } from '@/store/behavioralStore'
import { ICON } from '@/lib/type'

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
          const logoBg = (behavioralEnabled && MODE_ACCENT[behavioralMode]) ? MODE_ACCENT[behavioralMode] : 'var(--sb-accent)'
          return (
            <div style={{
              width: 32, height: 32,
              background: logoBg,
              borderRadius: 'var(--sb-r-chip)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 0.3s ease',
            }}>
              <LogoIcon size={18} color="var(--sb-card)" strokeWidth={2.5} />
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
              <button
                key={id}
                onClick={() => setActiveModule(id)}
                title={sidebarCollapsed ? label : undefined}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: sidebarCollapsed ? '10px 0' : '10px 12px',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  background: active ? 'rgba(var(--sb-accent-rgb),0.15)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--sb-r-chip)',
                  cursor: 'pointer',
                  color: active ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)',
                  marginBottom: 2,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'rgba(var(--sb-accent-rgb),0.15)'
                    el.style.color = 'var(--sb-ink-1)'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'transparent'
                    el.style.color = 'var(--sb-ink-4)'
                  }
                }}
              >
                <Icon size={18} strokeWidth={active ? 2.5 : 1.8} style={{ flexShrink: 0 }} />
                {!sidebarCollapsed && (
                  <span style={{ fontSize: 'var(--sb-t-body)', fontWeight: active ? 600 : 400, letterSpacing: '0.1px', whiteSpace: 'nowrap' }}>
                    {label}
                  </span>
                )}
                {active && !sidebarCollapsed && (
                  <div style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-accent)' }} />
                )}
              </button>
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
                  fontSize: 'var(--sb-t-micro)', fontWeight: 700, color: '#D4A827',
                  textTransform: 'uppercase', letterSpacing: '1.2px',
                }}>
                  {modeLabel} MODE
                </span>
              )}
              <button
                onClick={() => setActiveModule(id)}
                title={sidebarCollapsed ? 'Behavioral OS' : undefined}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: sidebarCollapsed ? '10px 0' : '10px 12px',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  background: active ? 'rgba(var(--sb-accent-rgb),0.15)' : 'transparent',
                  border: 'none', borderRadius: 'var(--sb-r-chip)', cursor: 'pointer',
                  color: active ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)',
                  marginBottom: 2, transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => { if (!active) { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(var(--sb-accent-rgb),0.15)'; el.style.color = 'var(--sb-ink-1)' } }}
                onMouseLeave={e => { if (!active) { const el = e.currentTarget as HTMLElement; el.style.background = 'transparent'; el.style.color = 'var(--sb-ink-4)' } }}
              >
                <Swords size={ICON.lg} strokeWidth={active ? 2.5 : 1.8} style={{ flexShrink: 0 }} />
                {!sidebarCollapsed && (
                  <span style={{ fontSize: 'var(--sb-t-body)', fontWeight: active ? 600 : 400, letterSpacing: '0.1px', whiteSpace: 'nowrap' }}>
                    Behavioral OS
                  </span>
                )}
                {active && !sidebarCollapsed && (
                  <div style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-accent)' }} />
                )}
              </button>
            </div>
          )
        })()}

        {/* System section */}
        <div style={{ borderTop: `1px solid ${'var(--sb-border)'}`, paddingTop: 10, marginTop: 4 }}>
          {!sidebarCollapsed && (
            <span style={{
              display: 'block', padding: '4px 12px 6px',
              fontSize: 'var(--sb-t-micro)', fontWeight: 700, color: '#D4A827',
              textTransform: 'uppercase', letterSpacing: '1.2px',
            }}>
              System
            </span>
          )}
          {SYSTEM_ITEMS.map(({ id, label, Icon }) => {
            const active = activeModule === id
            return (
              <button
                key={id}
                onClick={() => setActiveModule(id)}
                title={sidebarCollapsed ? label : undefined}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: sidebarCollapsed ? '10px 0' : '10px 12px',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  background: active ? 'rgba(var(--sb-accent-rgb),0.15)' : 'transparent',
                  border: 'none', borderRadius: 'var(--sb-r-chip)', cursor: 'pointer',
                  color: active ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)',
                  marginBottom: 2, transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'rgba(var(--sb-accent-rgb),0.15)'
                    el.style.color = 'var(--sb-ink-1)'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'transparent'
                    el.style.color = 'var(--sb-ink-4)'
                  }
                }}
              >
                <Icon size={18} strokeWidth={active ? 2.5 : 1.8} style={{ flexShrink: 0 }} />
                {!sidebarCollapsed && (
                  <span style={{ fontSize: 'var(--sb-t-body)', fontWeight: active ? 600 : 400, letterSpacing: '0.1px', whiteSpace: 'nowrap' }}>
                    {label}
                  </span>
                )}
                {active && !sidebarCollapsed && (
                  <div style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-accent)' }} />
                )}
              </button>
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
