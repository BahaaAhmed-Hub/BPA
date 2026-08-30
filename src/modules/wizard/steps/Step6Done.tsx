import { useEffect, useState } from 'react'
import { loadAccounts } from '@/lib/multiAccount'

interface WizardData {
  companies: unknown[]
  selectedTemplates: string[]
  customHabits: unknown[]
  selectedTaskIds: Set<string>
}

interface Props { data: WizardData }

function CountUp({ target, duration = 800 }: { target: number; duration?: number }) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (target === 0) return
    const steps = 30
    const inc = target / steps
    let current = 0
    const id = setInterval(() => {
      current = Math.min(current + inc, target)
      setVal(Math.round(current))
      if (current >= target) clearInterval(id)
    }, duration / steps)
    return () => clearInterval(id)
  }, [target, duration])
  return <>{val}</>
}

export function Step6Done({ data }: Props) {
  const extraAccounts = loadAccounts().filter(a => !a.isPrimary).length
  const totalAccounts = 1 + extraAccounts
  const totalHabits   = data.selectedTemplates.length + data.customHabits.length
  const totalTasks    = data.selectedTaskIds.size

  const stats = [
    { label: 'Accounts',  value: totalAccounts,          color: '#60A5FA', emoji: '🔗' },
    { label: 'Companies', value: data.companies.length,   color: '#7F77DD', emoji: '🏢' },
    { label: 'Habits',    value: totalHabits,             color: '#1D9E75', emoji: '🔥' },
    { label: 'Tasks',     value: totalTasks,              color: '#F97316', emoji: '✅' },
  ]

  return (
    <div style={{ textAlign: 'center', paddingTop: 16 }}>
      {/* Animated checkmark */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
        <svg width="72" height="72" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r="32" fill="none" stroke="rgba(127,119,221,0.2)" strokeWidth="3" />
          <circle cx="36" cy="36" r="32" fill="none" stroke="#7F77DD" strokeWidth="3"
            strokeDasharray="201" strokeDashoffset="0"
            style={{ animation: 'circleIn 0.6s ease forwards', transformOrigin: '36px 36px', transform: 'rotate(-90deg)' }}
          />
          <polyline points="22,36 32,46 50,28" fill="none" stroke="#7F77DD" strokeWidth="3.5"
            strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray="40" strokeDashoffset="0"
            style={{ animation: 'checkIn 0.4s 0.4s ease forwards' }}
          />
        </svg>
      </div>

      <h2 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 800, color: '#191712' }}>
        You're all set! 🎉
      </h2>
      <p style={{ margin: '0 0 32px', fontSize: 14, color: '#6C6553', lineHeight: 1.6 }}>
        Here's what we've set up for you:
      </p>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 32 }}>
        {stats.map(s => (
          <div key={s.label} style={{ padding: '16px 8px', borderRadius: 12, background: '#FFFFFF', border: '1px solid #E8E1CE' }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{s.emoji}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color, lineHeight: 1 }}>
              <CountUp target={s.value} />
            </div>
            <div style={{ fontSize: 11.5, color: '#9B9180', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '14px 20px', borderRadius: 10, background: 'rgba(127,119,221,0.06)', border: '1px solid rgba(127,119,221,0.15)', marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 13, color: '#6C6553', lineHeight: 1.6 }}>
          All your data syncs automatically. You can adjust everything in <strong style={{ color: '#191712' }}>Settings</strong> at any time.
        </p>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: '#9B9180' }}>
        Click <strong style={{ color: '#191712' }}>Finish</strong> below to enter your workspace.
      </p>

      <style>{`
        @keyframes circleIn { from { stroke-dashoffset: 201 } to { stroke-dashoffset: 0 } }
        @keyframes checkIn  { from { stroke-dashoffset: 40 }  to { stroke-dashoffset: 0 } }
      `}</style>
    </div>
  )
}
