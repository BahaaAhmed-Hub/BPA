// ─── The finance pages ask who you are before they open ──────────────────────
//
// Money is the one part of this app you would not want read over your shoulder,
// and a browser left open is read over your shoulder by definition. So the
// finance module is gated: a fresh tab is locked, and after a stretch of doing
// nothing it locks again.
//
// Two ways through, in this order:
//
//   1. **The device itself** — Touch ID, Face ID, Windows Hello, the iPad's
//      passcode. WebAuthn with a *platform* authenticator, `userVerification:
//      'required'`, so the browser will not hand back an assertion unless the
//      person in front of it proved themselves to the device. Nothing about the
//      finger or the face reaches this app; the credential is a key pair the
//      device holds and will only use after checking you.
//   2. **A password** — set here, hashed here (PBKDF2-SHA256, 210k rounds,
//      random salt), never stored in the clear and never sent anywhere. It is
//      the fallback for a device with no biometrics, and the way back in on a
//      device where the passkey was lost, so the lock cannot be turned on
//      without one.
//
// What this is honest about: it is a lock on the screen, not on the data. The
// rows still live in Postgres behind your Supabase session, and anyone who can
// run code in this browser can read them whichever way this flag is set. It
// stops the person who picks up your open laptop, which is the threat it is
// for.
//
// The *policy* (on, how long, the password hash) follows you between devices —
// it is in prefSync's shared keys, so turning the lock on here turns it on
// where you sign in next. The *passkey* does not and cannot: it is held by one
// device's secure element. Each device that wants biometrics registers its own.

const CONFIG_KEY  = 'finance-lock'          // shared between devices
const DEVICE_KEY  = 'finance-lock-device'   // this device's passkey, never shared
const SESSION_KEY = 'finance-lock-session'  // this tab's unlock, never persisted

/** How long a stretch of doing nothing before it locks again. */
export type Relock = number | 'session'

export interface LockConfig {
  enabled: boolean
  /** Minutes idle before re-locking, or the whole tab session. */
  relock: Relock
  password?: { salt: string; hash: string; rounds: number }
}

const DEFAULT: LockConfig = { enabled: false, relock: 15 }

export function loadLock(): LockConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return { ...DEFAULT }
    const parsed = JSON.parse(raw) as Partial<LockConfig>
    return {
      enabled: !!parsed.enabled,
      relock: parsed.relock === 'session' ? 'session' : Number(parsed.relock ?? DEFAULT.relock),
      password: parsed.password,
    }
  } catch { return { ...DEFAULT } }
}

/** Written only when something was actually configured — a default sitting in
 *  the key would stop prefSync ever filling it in from another device. */
export function saveLock(next: LockConfig): void {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(next)) } catch { /* noop */ }
  window.dispatchEvent(new CustomEvent('finance:lockChanged'))
}

// ─── The password ────────────────────────────────────────────────────────────

const ROUNDS = 210_000

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

async function derive(password: string, salt: Uint8Array, rounds: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: rounds, hash: 'SHA-256' },
    key, 256)
  return b64(bits)
}

export async function hashPassword(password: string): Promise<LockConfig['password']> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { salt: b64(salt.buffer), hash: await derive(password, salt, ROUNDS), rounds: ROUNDS }
}

export async function checkPassword(password: string, cfg = loadLock()): Promise<boolean> {
  if (!cfg.password) return false
  const got = await derive(password, unb64(cfg.password.salt), cfg.password.rounds)
  // Same length either way, so a plain compare leaks nothing an attacker with a
  // debugger in this browser could not already read.
  return got === cfg.password.hash
}

// ─── The device ──────────────────────────────────────────────────────────────

export interface DevicePasskey { id: string; label: string; addedAt: string }

export function loadPasskey(): DevicePasskey | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY)
    return raw ? JSON.parse(raw) as DevicePasskey : null
  } catch { return null }
}

export function forgetPasskey(): void {
  try { localStorage.removeItem(DEVICE_KEY) } catch { /* noop */ }
  window.dispatchEvent(new CustomEvent('finance:lockChanged'))
}

/** Whether this browser has a built-in authenticator at all — a fingerprint
 *  reader, a face camera, a passcode it will accept. */
export async function biometricsAvailable(): Promise<boolean> {
  try {
    if (typeof PublicKeyCredential === 'undefined') return false
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch { return false }
}

/** What to call this device on screen. Not identification — a label, so a list
 *  of two reads as "iPad" and "Mac" rather than two identical rows. */
export function deviceLabel(ua = navigator.userAgent): string {
  if (/iPad/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/iPhone/i.test(ua))  return 'iPhone'
  if (/Android/i.test(ua)) return 'Android device'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows PC'
  return 'This device'
}

/** What the unlock button should say, since every platform names its own. */
export function biometricName(ua = navigator.userAgent): string {
  if (/iPad|iPhone|Macintosh|Mac OS X/i.test(ua)) return 'Touch ID or Face ID'
  if (/Windows/i.test(ua)) return 'Windows Hello'
  return 'your device'
}

const challenge = () => crypto.getRandomValues(new Uint8Array(32))

/**
 *  Register this device. The key pair is made and kept by the device; all that
 *  comes back here is its id, which is what we ask for again at unlock.
 */
export async function registerPasskey(userName: string): Promise<DevicePasskey> {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: challenge(),
      rp: { name: 'The Professor — Finance' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: userName || 'finance',
        displayName: userName || 'Finance',
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      attestation: 'none',
    },
  }) as PublicKeyCredential | null
  if (!cred) throw new Error('No credential was created')
  const passkey: DevicePasskey = {
    id: b64(cred.rawId),
    label: deviceLabel(),
    addedAt: new Date().toISOString(),
  }
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(passkey)) } catch { /* noop */ }
  window.dispatchEvent(new CustomEvent('finance:lockChanged'))
  return passkey
}

/**
 *  Ask the device to prove it is you. `userVerification: 'required'` is the
 *  whole point: without it the platform would happily assert on a key it holds
 *  with nobody watching.
 */
export async function verifyPasskey(): Promise<boolean> {
  const passkey = loadPasskey()
  if (!passkey) return false
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: challenge(),
      allowCredentials: [{ type: 'public-key', id: unb64(passkey.id) as unknown as BufferSource }],
      userVerification: 'required',
      timeout: 60_000,
    },
  })
  return assertion !== null
}

// ─── Being unlocked ──────────────────────────────────────────────────────────
//
// In sessionStorage, so a new tab starts locked however long ago this one was
// opened, and a closed browser leaves nothing behind.

function stamp(): number {
  try { return Number(sessionStorage.getItem(SESSION_KEY) ?? 0) } catch { return 0 }
}

export function markActive(): void {
  try { sessionStorage.setItem(SESSION_KEY, String(Date.now())) } catch { /* noop */ }
}

export function lockNow(): void {
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* noop */ }
  window.dispatchEvent(new CustomEvent('finance:lockChanged'))
}

/** The one question every screen asks. */
export function isLocked(cfg = loadLock(), now = Date.now()): boolean {
  if (!cfg.enabled) return false
  const at = stamp()
  if (!at) return true
  if (cfg.relock === 'session') return false
  return now - at > Math.max(0, cfg.relock) * 60_000
}

export const RELOCK_CHOICES: { value: Relock; label: string }[] = [
  { value: 1,         label: 'After 1 minute idle' },
  { value: 5,         label: 'After 5 minutes idle' },
  { value: 15,        label: 'After 15 minutes idle' },
  { value: 60,        label: 'After an hour idle' },
  { value: 'session', label: 'Only when I open the app' },
]

export function relockLabel(r: Relock): string {
  return RELOCK_CHOICES.find(c => c.value === r)?.label ?? `After ${r} minutes idle`
}
