import { Block, DRow } from '../ui'

// The wrapper in Settings.tsx prints the "Sync rules" title; this is the card of rows under it.
export function SyncRulesSection() {
  const rows = [
    { label: 'Sync frequency',         sub: 'How often connected tools are polled',         value: 'Every 15 min' },
    { label: 'Imported tasks land in', sub: 'Untriaged work goes to the dump first',        value: 'The dump' },
    { label: 'Push completions back',  sub: 'Closing a task here closes it there',          value: 'On' },
    { label: 'Conflict wins',          sub: 'When both sides changed since the last sync',  value: 'Most recent edit' },
  ]
  return (
    <Block>
      {rows.map((row, i) => (
        <DRow key={row.label} label={row.label} sub={row.sub} last={i === rows.length - 1}>
          <select aria-label={row.label} style={{ fontSize: 'var(--sb-t-body-s)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)', padding: '5px 10px', background: 'var(--sb-field)', color: 'var(--sb-ink-1)', cursor: 'pointer', flexShrink: 0 }}>
            <option>{row.value}</option>
          </select>
        </DRow>
      ))}
    </Block>
  )
}
