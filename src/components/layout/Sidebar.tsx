
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
} from 'lucide-react'
import { useUIStore } from '@/store/uiStore'

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
  const { sidebarCollapsed, activeModule, toggleSidebar, setActiveModule } = useUIStore()

  return (
    <aside
      style={{
        width: sidebarCollapsed ? 64 : 220,
        minWidth: sidebarCollapsed ? 64 : 220,
        background: '#2A2218',
        borderRight: '1px solid #3A3020',
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
          borderBottom: '1px solid #3A3020',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
          minHeight: 64,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            background: '#C49A3C',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <GraduationCap size={18} color="#1C1814" strokeWidth={2.5} />
        </div>
        {!sidebarCollapsed && (
          <span
            style={{
              fontFamily: "'Cabinet Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: 16,
              color: '#F0E8D8',
              letterSpacing: '-0.3px',
              whiteSpace: 'nowrap',
            }}
          >
            The Professor
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '12px 8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
                  background: active ? 'rgba(196, 154, 60, 0.12)' : 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  color: active ? '#C49A3C' : '#8A7A60',
                  marginBottom: 2,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'rgba(255,255,255,0.04)'
                    el.style.color = '#F0E8D8'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'transparent'
                    el.style.color = '#8A7A60'
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
                  <div style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: '50%', background: '#C49A3C' }} />
                )}
              </button>
            )
          })}
        </div>

        {/* System section */}
        <div style={{ borderTop: '1px solid #3A3020', paddingTop: 10, marginTop: 4 }}>
          {!sidebarCollapsed && (
            <span style={{
              display: 'block', padding: '4px 12px 6px',
              fontSize: 9.5, fontWeight: 700, color: '#5A4A30',
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
                  background: active ? 'rgba(196, 154, 60, 0.12)' : 'transparent',
                  border: 'none', borderRadius: 8, cursor: 'pointer',
                  color: active ? '#C49A3C' : '#8A7A60',
                  marginBottom: 2, transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'rgba(255,255,255,0.04)'
                    el.style.color = '#F0E8D8'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = 'transparent'
                    el.style.color = '#8A7A60'
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
                  <div style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: '50%', background: '#C49A3C' }} />
                )}
              </button>
            )
          })}
        </div>
      </nav>

      {/* Collapse toggle */}
      <div style={{ padding: '12px 8px', borderTop: '1px solid #3A3020' }}>
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
            color: '#8A7A60',
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
