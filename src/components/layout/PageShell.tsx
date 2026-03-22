

interface PageShellProps {
  children: React.ReactNode
}

export function PageShell({ children }: PageShellProps) {
  return (
    <main
      style={{
        flex: 1,
        overflow: 'auto',
        background: '#0D0F1A',
        minHeight: '100vh',
      }}
    >
      {children}
    </main>
  )
}
