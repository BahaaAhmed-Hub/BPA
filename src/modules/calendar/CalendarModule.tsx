import { TopBar } from '@/components/layout/TopBar'
import { CalendarView } from './CalendarView'

export function CalendarModule() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TopBar title="Calendar" subtitle="Daily and weekly view — all your events in one place." />
      <CalendarView />
    </div>
  )
}
