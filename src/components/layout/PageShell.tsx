

interface PageShellProps {
  children: React.ReactNode
}

export function PageShell({ children }: PageShellProps) {
  return (
    <main
      style={{
        flex: 1,
        overflow: 'auto',
        background: 'var(--sb-page)',
        height: 'calc(100 * var(--vh))',
      }}
    >
      {children}
    </main>
  )
}
