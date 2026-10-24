
export function SyncRulesSection() {
  return (
    <div>
      {[
        { label: 'Sync frequency',         sub: 'How often connected tools are polled',         value: 'Every 15 min' },
        { label: 'Imported tasks land in', sub: 'Untriaged work goes to the dump first',        value: 'The dump' },
        { label: 'Push completions back',  sub: 'Closing a task here closes it there',          value: 'On' },
        { label: 'Conflict wins',          sub: 'When both sides changed since the last sync',  value: 'Most recent edit' },
      ].map((row, i, arr) => (
        <div key={row.label} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '10px 0', borderBottom: i === arr.length - 1 ? 'none' : 'var(--sb-border-width) solid var(--sb-hairline)',
        }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-1)' }}>{row.label}</p>
            <p style={{ margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{row.sub}</p>
          </div>
          <select style={{ fontSize: 'var(--sb-t-body-s)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)', padding: '5px 10px', background: 'var(--sb-field)', color: 'var(--sb-ink-1)', cursor: 'pointer', flexShrink: 0 }}>
            <option>{row.value}</option>
          </select>
        </div>
      ))}
    </div>
  )
}
