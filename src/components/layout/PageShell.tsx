

interface PageShellProps {
  children: React.ReactNode
}

export function PageShell({ children }: PageShellProps) {
  return (
    <main
      style={{
        flex: 1,
        overflow: 'auto',
        background: '#1C1814',
        minHeight: '100vh',
      }}
    >
      {children}
    </main>
  )
}
