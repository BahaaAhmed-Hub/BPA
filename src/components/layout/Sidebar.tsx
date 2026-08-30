
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
        background: '#FCFAF4',
        borderRight: `1px solid ${'#E8E1CE'}`,
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
          borderBottom: `1px solid ${'#E8E1CE'}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
        }}
      >
        {(() => {
          const modeKey = behavioralEnabled ? behavioralMode : 'default'
          const LogoIcon = MODE_ICONS[modeKey] ?? GraduationCap
          const logoBg = (behavioralEnabled && MODE_ACCENT[behavioralMode]) ? MODE_ACCENT[behavioralMode] : '#F5D14E'
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
              color: '#191712',
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
                  background: active ? 'rgba(245,209,78,0.15)' : 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  color: active ? '#191712' : '#9B9180',
                  marginBottom: 2,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'rgba(245,209,78,0.15)'
                    el.style.color = '#191712'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'transparent'
                    el.style.color = '#9B9180'
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
                  <div style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: '50%', background: '#F5D14E' }} />
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
            <div style={{ borderTop: `1px solid ${'#E8E1CE'}`, paddingTop: 10, marginTop: 4 }}>
              {!sidebarCollapsed && (
                <span style={{
                  display: 'block', padding: '4px 12px 6px',
                  fontSize: 9.5, fontWeight: 700, color: '#D4A827',
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
                  background: active ? 'rgba(245,209,78,0.15)' : 'transparent',
                  border: 'none', borderRadius: 8, cursor: 'pointer',
                  color: active ? '#191712' : '#9B9180',
                  marginBottom: 2, transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => { if (!active) { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(245,209,78,0.15)'; el.style.color = '#191712' } }}
                onMouseLeave={e => { if (!active) { const el = e.currentTarget as HTMLElement; el.style.background = 'transparent'; el.style.color = '#9B9180' } }}
              >
                <Swords size={18} strokeWidth={active ? 2.5 : 1.8} style={{ flexShrink: 0 }} />
                {!sidebarCollapsed && (
                  <span style={{ fontSize: 13.5, fontWeight: active ? 600 : 400, letterSpacing: '0.1px', whiteSpace: 'nowrap' }}>
                    Behavioral OS
                  </span>
                )}
                {active && !sidebarCollapsed && (
                  <div style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: '50%', background: '#F5D14E' }} />
                )}
              </button>
            </div>
          )
        })()}

        {/* System section */}
        <div style={{ borderTop: `1px solid ${'#E8E1CE'}`, paddingTop: 10, marginTop: 4 }}>
          {!sidebarCollapsed && (
            <span style={{
              display: 'block', padding: '4px 12px 6px',
              fontSize: 9.5, fontWeight: 700, color: '#D4A827',
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
                  background: active ? 'rgba(245,209,78,0.15)' : 'transparent',
                  border: 'none', borderRadius: 8, cursor: 'pointer',
                  color: active ? '#191712' : '#9B9180',
                  marginBottom: 2, transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'rgba(245,209,78,0.15)'
                    el.style.color = '#191712'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'transparent'
                    el.style.color = '#9B9180'
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
                  <div style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: '50%', background: '#F5D14E' }} />
                )}
              </button>
            )
          })}
        </div>
      </nav>

      {/* Collapse toggle */}
      <div style={{ padding: '12px 8px', borderTop: `1px solid ${'#E8E1CE'}` }}>
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
            color: '#9B9180',
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
