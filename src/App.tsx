
import { useEffect } from 'react'
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
import { useAuthStore } from './store/authStore'
import { supabase } from './lib/supabase'

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
  const { setUser, setLoading } = useAuthStore()

  useEffect(() => {
    // Hydrate auth from existing Supabase session on load
    void supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user
      setUser(u ? { id: u.id, email: u.email ?? '', name: u.user_metadata?.full_name as string | undefined, avatarUrl: u.user_metadata?.avatar_url as string | undefined } : null)
      setLoading(false)
    })

    // Keep in sync with auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user
      setUser(u ? { id: u.id, email: u.email ?? '', name: u.user_metadata?.full_name as string | undefined, avatarUrl: u.user_metadata?.avatar_url as string | undefined } : null)
      setLoading(false)
      // Persist provider_token (Google OAuth) — Supabase doesn't restore it after refresh
      if (session?.provider_token) {
        localStorage.setItem('google_provider_token', session.provider_token)
      } else if (!session) {
        localStorage.removeItem('google_provider_token')
      }
    })

    return () => subscription.unsubscribe()
  }, [setUser, setLoading])

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
