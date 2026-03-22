
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
import { signInWithGoogle } from './lib/google'
import { GraduationCap } from 'lucide-react'

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
  const { setUser, setLoading, user, loading } = useAuthStore()

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

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#1C1814' }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#C49A3C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <GraduationCap size={18} color="#1C1814" strokeWidth={2.5} />
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#1C1814' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: '#C49A3C', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <GraduationCap size={28} color="#1C1814" strokeWidth={2.5} />
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: 32, fontWeight: 800, color: '#F0E8D8', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-1px' }}>
            The Professor
          </h1>
          <p style={{ margin: '0 0 32px', fontSize: 14, color: '#8A7A60', lineHeight: 1.6 }}>
            Your AI-powered executive operating system.<br />Sign in to get started.
          </p>
          <button
            onClick={() => void signInWithGoogle()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '12px 28px', borderRadius: 10,
              background: 'rgba(196,154,60,0.12)', border: '1px solid rgba(196,154,60,0.3)',
              color: '#C49A3C', fontSize: 15, fontWeight: 600, cursor: 'pointer',
              fontFamily: "'Cabinet Grotesk', sans-serif",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 6.294C4.672 4.169 6.656 3.58 9 3.58z"/></svg>
            Sign in with Google
          </button>
        </div>
      </div>
    )
  }

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
