import { CalendarIntelligence } from './CalendarIntelligence'

export function CalendarModule() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 66px)', overflow: 'hidden' }}>
      <CalendarIntelligence />
    </div>
  )
}
