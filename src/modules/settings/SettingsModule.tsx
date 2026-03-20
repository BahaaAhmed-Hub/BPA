import { TopBar } from '@/components/layout/TopBar'
import { Settings } from './Settings'

export function SettingsModule() {
  return (
    <div>
      <TopBar
        title="Settings"
        subtitle="Manage your profile, schedule rules, and preferences."
      />
      <Settings />
    </div>
  )
}
