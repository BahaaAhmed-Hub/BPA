
import { TopBar } from '@/components/layout/TopBar'
import { CalendarIntelligence } from './CalendarIntelligence'

export function CalendarModule() {
  return (
    <div>
      <TopBar title="Calendar Intelligence" subtitle="Smart scheduling — your time, optimized." />
      <CalendarIntelligence />
    </div>
  )
}
