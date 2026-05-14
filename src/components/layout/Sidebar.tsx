
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
import { getTheme } from '@/lib/themes'
import { useBehavioralStore } from '@/store/behavioralStore'

const NAV_ITEMS = [
  { id: 'dashboard',  label: 'Dashboard',      Icon: LayoutDashboard },
  { id: 'tasks',      label: 'Task Command',    Icon: CheckSquare },
  { id: 'calendar',   label: 'Calendar Intel',  Icon: Calendar },
  { id: 'inbox',      label: 'Command Inbox',   Icon: Inbox },
  { id: 'habits',     label: 'Habits Tracker',  Icon: Target },
  { id: 'review',     label: 'Weekly Review',   Icon: RefreshCw },
  { id: 'morning',    label: 'Morning Brief',   Icon: Sun },
]

const SYSTEM_ITEMS = [
  { id: 'settings', label: 'Settings', Icon: Settings },
]

export function Sidebar() {
  const { sidebarCollapsed, activeModule, toggleSidebar, setActiveModule, themeId } = useUIStore()
  const theme = getTheme(themeId)
  const behavioralEnabled = useBehavioralStore(s => s.enabled)
  const behavioralMode    = useBehavioralStore(s => s.mode)

  return (
    <aside
      style={{
        width: sidebarCollapsed ? 64 : 220,
        minWidth: sidebarCollapsed ? 64 : 220,
        background: theme.sidebarBg,
        borderRight: `1px solid ${theme.border}`,
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
      {/* Logo */}
      <div
        style={{
          padding: sidebarCollapsed ? '20px 0' : '20px 20px',
          borderBottom: `1px solid ${theme.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
          minHeight: 64,
        }}
      >
        {(() => {
          const modeKey = behavioralEnabled ? behavioralMode : 'default'
          const LogoIcon = MODE_ICONS[modeKey] ?? GraduationCap
          const logoBg = (behavioralEnabled && MODE_ACCENT[behavioralMode]) ? MODE_ACCENT[behavioralMode] : theme.accent
          return (
            <div style={{
              width: 32, height: 32,
              background: logoBg,
              borderRadius: behavioralMode === 'samurai' && behavioralEnabled ? 4 : 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 0.3s ease',
            }}>
              <LogoIcon size={18} color="#FFFFFF" strokeWidth={2.5} />
            </div>
          )
        })()}
        {!sidebarCollapsed && (
          <span
            style={{
              fontFamily: "'Cabinet Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: 16,
              color: theme.text,
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
                  background: active ? theme.accentFill : 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  color: active ? theme.text : theme.textDim,
                  marginBottom: 2,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = theme.accentFill
                    el.style.color = theme.text
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'transparent'
                    el.style.color = theme.textDim
                  }
                }}
              >
                <Icon size={18} strokeWidth={active ? 2.5 : 1.8} style={{ flexShrink: 0 }} />
                {!sidebarCollapsed && (
                  <span style={{ fontSize: 13.5, fontWeight: active ? 600 : 400, letterSpacing: '0.1px', whiteSpace: 'nowrap' }}>
                    {label}
                  </span>
                )}
                {active && !sidebarCollapsed && (
                  <div style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: '50%', background: theme.accent }} />
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
            <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 10, marginTop: 4 }}>
              {!sidebarCollapsed && (
                <span style={{
                  display: 'block', padding: '4px 12px 6px',
                  fontSize: 9.5, fontWeight: 700, color: theme.accentBright,
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
                  background: active ? theme.accentFill : 'transparent',
                  border: 'none', borderRadius: 8, cursor: 'pointer',
                  color: active ? theme.text : theme.textDim,
                  marginBottom: 2, transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => { if (!active) { const el = e.currentTarget as HTMLElement; el.style.background = theme.accentFill; el.style.color = theme.text } }}
                onMouseLeave={e => { if (!active) { const el = e.currentTarget as HTMLElement; el.style.background = 'transparent'; el.style.color = theme.textDim } }}
              >
                <Swords size={18} strokeWidth={active ? 2.5 : 1.8} style={{ flexShrink: 0 }} />
                {!sidebarCollapsed && (
                  <span style={{ fontSize: 13.5, fontWeight: active ? 600 : 400, letterSpacing: '0.1px', whiteSpace: 'nowrap' }}>
                    Behavioral OS
                  </span>
                )}
                {active && !sidebarCollapsed && (
                  <div style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: '50%', background: theme.accent }} />
                )}
              </button>
            </div>
          )
        })()}

        {/* System section */}
        <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 10, marginTop: 4 }}>
          {!sidebarCollapsed && (
            <span style={{
              display: 'block', padding: '4px 12px 6px',
              fontSize: 9.5, fontWeight: 700, color: theme.accentBright,
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
                  background: active ? theme.accentFill : 'transparent',
                  border: 'none', borderRadius: 8, cursor: 'pointer',
                  color: active ? theme.text : theme.textDim,
                  marginBottom: 2, transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = theme.accentFill
                    el.style.color = theme.text
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'transparent'
                    el.style.color = theme.textDim
                  }
                }}
              >
                <Icon size={18} strokeWidth={active ? 2.5 : 1.8} style={{ flexShrink: 0 }} />
                {!sidebarCollapsed && (
                  <span style={{ fontSize: 13.5, fontWeight: active ? 600 : 400, letterSpacing: '0.1px', whiteSpace: 'nowrap' }}>
                    {label}
                  </span>
                )}
                {active && !sidebarCollapsed && (
                  <div style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: '50%', background: theme.accent }} />
                )}
              </button>
            )
          })}
        </div>
      </nav>

      {/* Collapse toggle */}
      <div style={{ padding: '12px 8px', borderTop: `1px solid ${theme.border}` }}>
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
            color: theme.textDim,
            borderRadius: 6,
          }}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed
            ? <ChevronRight size={16} />
            : <ChevronLeft size={16} />
          }
        </button>
      </div>
    </aside>
  )
}
