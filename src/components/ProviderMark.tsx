import { GOOGLE_BRAND, MICROSOFT_BRAND } from '@/lib/providerBrand'

/** Who an account is with. Every account the app connects today signs in with Google (a Gmail address
 *  or a Workspace domain — the mark is the same), so that is the default; an address that is plainly
 *  Microsoft's (outlook, hotmail, live, msn, office365) is drawn with Microsoft's, ready for the day a
 *  Microsoft account can be connected. Anything else falls back to the initial. */
export type Provider = 'google' | 'microsoft'

export function providerOf(email: string | undefined): Provider {
  const d = (email ?? '').split('@')[1]?.toLowerCase() ?? ''
  return /(^|\.)(outlook|hotmail|live|msn|office365|onmicrosoft)\./.test(`${d}.`) ? 'microsoft' : 'google'
}

export const PROVIDER_NAME: Record<Provider, string> = { google: 'Google', microsoft: 'Microsoft 365' }

/** A white disc with the provider's own mark in its own colours (brand marks are not themed). */
export function ProviderMark({ email, size = 32, ring }: { email?: string; size?: number; ring?: string }) {
  const p = providerOf(email)
  const g = Math.round(size * 0.56)
  return (
    <span role="img" aria-label={PROVIDER_NAME[p]} title={PROVIDER_NAME[p]} style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'white', border: `var(--sb-border-width) solid ${ring ?? 'var(--sb-border)'}`,
    }}>
      {p === 'google' ? (
        <svg width={g} height={g} viewBox="0 0 48 48" aria-hidden>
          <path fill={GOOGLE_BRAND.red} d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
          <path fill={GOOGLE_BRAND.blue} d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-4 6.7-9.9 6.7-17.4z" />
          <path fill={GOOGLE_BRAND.yellow} d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
          <path fill={GOOGLE_BRAND.green} d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
        </svg>
      ) : (
        <svg width={g} height={g} viewBox="0 0 23 23" aria-hidden>
          <path fill={MICROSOFT_BRAND.red} d="M1 1h10v10H1z" /><path fill={MICROSOFT_BRAND.green} d="M12 1h10v10H12z" />
          <path fill={MICROSOFT_BRAND.blue} d="M1 12h10v10H1z" /><path fill={MICROSOFT_BRAND.yellow} d="M12 12h10v10H12z" />
        </svg>
      )}
    </span>
  )
}
