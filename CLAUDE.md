# BPA — Professor AI App · Project Memory

## Stack
- **React 19 + TypeScript + Vite + Zustand**
- Branch: `claude/build-professor-ai-app-sDbyz` (push here + main)
- Always run `npm run build` to verify before pushing (strict `noUnusedLocals`)

## Design System — Sunlit Bento
| Token | Value |
|---|---|
| Page bg | `#F7F4EA` |
| Rail/nav bg | `#FCFAF4` |
| Card bg | `#FFFFFF` |
| Field bg | `#FAF7EC` |
| Border | `#E8E1CE` |
| Hairline | `#F0EBDC` |
| Primary ink | `#191712` |
| Muted ink | `#6C6553` |
| Ghost ink | `#9B9180` |
| Amber accent | `#F5D14E` |
| Olive positive | `#5F7038` |
| Rust negative | `#B4523A` |
| Active nav pill | `#FFFFFF` bg + `box-shadow: 0 1px 3px rgba(25,23,18,.16)` (NOT amber) |

Typography: `Outfit` headings, system-ui body. Section titles: 28px Outfit 600, `letter-spacing: -0.03em`.

## Key Files
| File | What it does |
|---|---|
| `src/modules/settings/Settings.tsx` | All settings — nav groups, section components |
| `src/modules/tasks/TaskCard.tsx` | 3-row task card (9A design) |
| `src/modules/habits/HabitsModule.tsx` | Habits table + 10B side detail panel |
| `src/modules/finance/screens/BudgetScreen.tsx` | Budget + 20E envelope drill-down overlay |
| `src/App.tsx` | Router / shell |
| `src/store/`, `src/lib/` | Zustand stores, DB sync, Google OAuth |

## Settings — Section → Component Mapping (CONFIRMED CORRECT as of latest commit)
| Nav group | Section id | Title shown | Component rendered |
|---|---|---|---|
| YOU | `profile` | Profile | `ProfileSection` |
| CONNECTED | `accounts` | Accounts & companies | `CompaniesSection` (company cards + people) |
| CONNECTED | `professor` | AI | `ProfessorSection` |
| CONNECTED | `schedule` | Schedule rules | `ScheduleSection` |
| CONNECTED | `blocking` | Integrations | `AccountsSection` (Google OAuth) + `BlockingRulesSection` |
| WORK | `tasks` | Tasks | `TaskStatusesSection` |
| WORK | `habits` | Habits | `HabitsSection` |
| SYSTEM | `notifications` | Automation | `AutomationSection` (4 rule cards + Reminders) |
| SYSTEM | `appearance` | Appearance | `AppearanceSection` |
| SYSTEM | `behavioral` | Behavioral OS | `BehavioralSection` |
| SYSTEM | `companies` | Data & privacy | `DataPrivacySection` |
| SYSTEM | `finance` | Finance | `FinanceSection` |

## Design Screen → Implementation Status
| Screen | Status | Notes |
|---|---|---|
| 9A Task card | ✅ Done | 3-row layout, company dot, owner initials badge, daysOpen() |
| 10B Habit detail panel | ✅ Done | 272px side panel, heatmap, stats, cadence |
| 11A Settings profile page | ✅ Done | Outfit 28px title, SETTINGS eyebrow, YOU/CONNECTED/WORK/SYSTEM nav |
| 11B Accounts & companies | ✅ Done | CompaniesSection mapped to `accounts` id |
| 11C Tasks settings | ✅ Done | `TaskStatusesSection` |
| 11F Automation | ✅ Done | `AutomationSection` with 4 rule cards |
| 11G Finance settings | ✅ Done | FinanceSection with envelope/figures/dates fields |
| 20E Envelope drill-down | ✅ Done | 520px right overlay, period selector, tx flags |

## Automation Rules (11F — stored in localStorage `professor-automation-rules`)
1. Write the morning brief · WHEN every day at 06:40, before you wake
2. Draft replies for NEEDS YOU mail · WHEN a thread is marked needs-you and sits over 4 hours
3. Block focus time for P0 tasks · WHEN a P0 task has no calendar block by 09:00
4. Distribute the dump · WHEN the brain dump passes 12 tasks

## Common Patterns
```tsx
// Toggle component (used everywhere in Settings)
<Toggle checked={bool} onChange={(v: boolean) => ...} />

// FieldRow (label + right-aligned control)
<FieldRow label="..." sub="optional sublabel">
  <Toggle ... />
</FieldRow>

// Sunlit card wrapper
<div style={{ background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 14,
  padding: '22px 24px 24px', boxShadow: '0 1px 3px rgba(25,23,18,0.06)' }}>

// Section eyebrow
<div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em',
  color: '#6C6553', textTransform: 'uppercase', marginBottom: 4 }}>SETTINGS</div>
```

## Git Push Pattern
```bash
git add -A
git commit -m "feat: ..."
git push origin main
git push origin HEAD:claude/build-professor-ai-app-sDbyz
```

## Build Gotchas
- `noUnusedLocals: true` — every declared variable must be used. Prefix unused params with `_`. For unused module-level functions/consts, delete them or export them.
- Pre-existing unused vars scattered in `finance/screens/` — fix by prefixing or deleting if truly dead code.
- `npm run build` = `tsc -b && vite build` — both must pass.
