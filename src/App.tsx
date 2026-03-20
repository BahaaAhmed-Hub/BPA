
import { Sidebar } from './components/layout/Sidebar'
import { PageShell } from './components/layout/PageShell'
import { ExecutiveDashboard } from './modules/dashboard/ExecutiveDashboard'
import { TaskCommand } from './modules/tasks/TaskCommand'
import { CalendarModule } from './modules/calendar/CalendarModule'
import { InboxModule } from './modules/inbox/InboxModule'
import { HabitsModule } from './modules/habits/HabitsModule'
import { ReviewModule } from './modules/review/ReviewModule'
import { MorningModule } from './modules/morning/MorningModule'
import { SettingsModule } from './modules/settings/SettingsModule'
import { useUIStore } from './store/uiStore'

function ActiveModule() {
  const activeModule = useUIStore(s => s.activeModule)
  switch (activeModule) {
    case 'dashboard':  return <ExecutiveDashboard />
    case 'tasks':      return <TaskCommand />
    case 'calendar':   return <CalendarModule />
    case 'inbox':      return <InboxModule />
    case 'habits':     return <HabitsModule />
    case 'review':     return <ReviewModule />
    case 'morning':    return <MorningModule />
    case 'settings':   return <SettingsModule />
    default:           return <ExecutiveDashboard />
  }
}

function App() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#1C1814' }}>
      <Sidebar />
      <PageShell>
        <ActiveModule />
      </PageShell>
    </div>
  )
}

export default App
