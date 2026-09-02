# BPA — Professor AI App · Project Memory

## Stack
- **React 19 + TypeScript + Vite + Zustand**
- Branch: `claude/professor-web-app-dev-tnj0uk` (current dev branch; older work was on `claude/build-professor-ai-app-sDbyz`)
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
| `src/lib/liveSync.ts` | Cross-device live sync (Realtime push + poll fallback) |

## Cross-device sync
Habits, tasks and finance stay in step **while both devices are open** — no reload.
`startLiveSync(userId, handlers)` (App.tsx, 3 auth call sites) asks the owning store to
reload; it never applies row deltas. Woken by Postgres change events (~1s, needs
`20260004_realtime.sql`) and by a poll + visibility/focus/online pull (45s alone,
5 min once Realtime is confirmed). Finance had no `loadFromDB()` caller at all before this.

Three rules any change here must keep:
- **`markLocalWrite(domain)`** on every write path, or a reload pulls the old row back
  over an edit in progress. Stores call it; `financeDb.ts` calls it in its 11 helpers.
- **Dirty sets** (`professor-habits-dirty`, `professor-tasks-dirty`) answer "is this
  device's copy newer?" A row missing from the server is *deleted elsewhere* unless it
  is dirty — otherwise every delete undoes itself. Seeded with all local ids on a device
  that predates the key.
- **Push the hydration merge back only when it differs from what the server just sent**,
  or two open devices trade writes forever.

## Settings — Section → Component Mapping (CONFIRMED CORRECT as of latest commit)
| Nav group | Section id | Title shown | Component rendered |
|---|---|---|---|
| YOU | `profile` | Profile | `ProfileSection` |
| YOU | `billing` | Billing | `BillingSection` (plan tile, payment, invoices) |
| CONNECTED | `accounts` | Accounts & companies | `CompaniesSection` (company cards + people) |
| CONNECTED | `professor` | AI | `ProfessorSection` (model, autonomy, toggles, tone) |
| CONNECTED | `schedule` | Schedule rules | `ScheduleSection` |
| CONNECTED | `blocking` | Integrations | `IntegrationsSection` (Notion/Asana/Trello + Google OAuth + calendar sync) |
| WORK | `tasks` | Tasks | `TaskStatusesSection` |
| WORK | `habits` | Habits | `HabitsSection` |
| SYSTEM | `automation` | Automation | `AutomationSection` (7 rule cards) |
| SYSTEM | `notifications` | Notifications | `NotificationsMatrixSection` (Push/Mail/Digest per event + quiet hours) |
| SYSTEM | `appearance` | Appearance | `AppearanceSection` |
| SYSTEM | `behavioral` | Behavioral OS | `BehavioralSection` |
| SYSTEM | `companies` | Data & privacy | `DataPrivacySection` |
| SYSTEM | `finance` | Finance | `FinanceSection` |

## Design Screen → Implementation Status
| Screen | Status | Notes |
|---|---|---|
| 9A Task card | ✅ Done | 3-row layout, company dot, owner initials badge, daysOpen() |
| 10B Habit detail panel | ✅ Done | 272px side panel, heatmap, stats, cadence |
| 11A Profile + Billing | ✅ Done | Profile section + BillingSection with plan/invoices |
| 11B Accounts & companies | ✅ Done | CompaniesSection mapped to `accounts` id |
| 11B AI settings | ✅ Done | ProfessorSection with model picker, autonomy, tone |
| 11C Tasks + Habits | ✅ Done | TaskStatusesSection + HabitsSection |
| 11D Integrations | ✅ Done | IntegrationsSection with Notion/Asana/Trello/Apple Notes |
| 11F Automation | ✅ Done | AutomationSection with 7 rule cards + run log |
| 11F Notifications | ✅ Done | NotificationsMatrixSection Push/Mail/Digest matrix |
| 11G Finance settings | ✅ Done | FinanceSection with envelope/figures/dates fields |
| 20E Envelope drill-down | ✅ Done | 520px right overlay, period selector, tx flags |

## Automation Rules (11F — stored in localStorage `professor-automation-rules`)
1. Write the morning brief · WHEN every day at 06:40, before you wake
2. Draft replies for NEEDS YOU mail · WHEN a thread is marked needs-you and sits over 4 hours
3. Block focus time for P0 tasks · WHEN a P0 task has no calendar block by 09:00
4. Distribute the dump · WHEN the brain dump passes 12 tasks
5. Roll unfinished tasks forward · WHEN a scheduled task ends the day untouched
6. Archive newsletters · WHEN a thread is promotional and nobody replied in 3 days
7. Close the week · WHEN Sunday 20:00, if the review has not been opened

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

## Settings — 11A artboard primitives
`Settings.tsx` has a shared set of design primitives used by every artboard-accurate section:
`PILL_BASE`, `GhostPill`, `PillValue`, `DRow` (label+sub left / control hard-right),
`Segmented`, `pillSelectStyle`, `VisaBadge`. Prefer these over `FieldRow`/`inputStyle`
when bringing a section up to the artboards.

Layout: the page header (eyebrow + title + `Setup wizard`/`Export`) spans full width
**above** the rail. The rail is a floating 250px card; the active nav item is a solid
black pill (`#191712` bg, white text). Cards use `alignSelf: 'start'` so they size to
content — the content column scrolls, not each card.

Profile fields **autosave** (1.2s debounce → `saveProfileToDB`); `profileHydrated` ref
swallows the write-back that DB hydration would otherwise trigger.

## Git Push Pattern
```bash
git add -A
git commit -m "feat: ..."
git push -u origin claude/professor-web-app-dev-tnj0uk
```

## Build Gotchas
- `noUnusedLocals: true` — every declared variable must be used. Prefix unused params with `_`. For unused module-level functions/consts, delete them or export them.
- Pre-existing unused vars scattered in `finance/screens/` — fix by prefixing or deleting if truly dead code.
- `npm run build` = `tsc -b && vite build` — both must pass.
