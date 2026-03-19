
import { TopBar } from '@/components/layout/TopBar'
import { MorningBrief } from './MorningBrief'

export function MorningModule() {
  return (
    <div>
      <TopBar title="Morning Brief" subtitle="Your day, curated. Start with clarity." />
      <MorningBrief />
    </div>
  )
}
