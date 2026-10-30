import { CalendarIntelligence } from './CalendarIntelligence'
import { NAV_H } from '@/App'

export function CalendarModule() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: `calc(calc(100 * var(--vh)) - ${NAV_H})`, overflow: 'hidden' }}>
      <CalendarIntelligence />
    </div>
  )
}
