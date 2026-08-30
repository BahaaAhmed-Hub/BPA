

interface PageShellProps {
  children: React.ReactNode
}

export function PageShell({ children }: PageShellProps) {
  return (
    <main
      style={{
        flex: 1,
        overflow: 'auto',
        background: '#F7F4EA',
        height: '100vh',
      }}
    >
      {children}
    </main>
  )
}
