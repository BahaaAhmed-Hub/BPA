import { TopBar } from '@/components/layout/TopBar'
import { CalendarIntelligence } from './CalendarIntelligence'

export function CalendarModule() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TopBar title="Calendar Intelligence" subtitle="Your schedule, unified across all accounts." />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <CalendarIntelligence />
      </div>
    </div>
  )
}
