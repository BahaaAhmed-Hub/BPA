// ─── Weather ─────────────────────────────────────────────────────────────────
// The calendar's hour gutter can say what the weather will be doing at that
// hour. The location comes from the timezone you picked in Settings — no
// location prompt, and it follows you when you change the setting. The
// forecast comes from Open-Meteo, which needs no key. If the timezone names
// nowhere we can place, or the fetch fails, the gutter simply says nothing —
// a made-up temperature would be worse than none.

const CACHE_KEY = 'professor-weather-cache'
const PLACE_KEY = 'professor-weather-places'   // timezone → coords, once resolved
const SYNCED_KEY = 'professor-location'        // exact coords, from an explicit sync

export interface HourWeather {
  /** Degrees celsius, rounded. */
  temp: number
  /** WMO weather code, as Open-Meteo reports it. */
  code: number
}

/** Keyed "YYYY-MM-DDTHH", in the timezone the forecast was asked for. */
export type WeatherByHour = Record<string, HourWeather>

interface Coords { lat: number; lon: number }

/** The timezone the user chose in Settings, falling back to the browser's. */
export function settingsTimezone(): string {
  try {
    const raw = localStorage.getItem('professor-settings')
    const tz = raw ? (JSON.parse(raw) as { timezone?: string }).timezone : undefined
    if (tz) return tz
  } catch { /* unreadable settings */ }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch { return null }
}

/** An IANA zone names the city it is anchored to — "Africa/Cairo",
 *  "America/New_York" — so the city is the last segment, underscores undone. */
function timezoneCity(tz: string): string {
  const last = tz.split('/').pop() ?? tz
  return last.replace(/_/g, ' ')
}

/** Places the timezone's city on the map, once per timezone, and remembers it.
 *  If you synced your timezone from your actual location, the exact coordinates
 *  that sync captured are used instead of the zone's headline city. */
async function coordsForTimezone(tz: string): Promise<Coords | null> {
  const synced = readJson<Coords & { tz: string }>(SYNCED_KEY)
  if (synced && synced.tz === tz) return { lat: synced.lat, lon: synced.lon }

  const places = readJson<Record<string, Coords>>(PLACE_KEY) ?? {}
  if (places[tz]) return places[tz]

  try {
    const url = 'https://geocoding-api.open-meteo.com/v1/search'
      + `?name=${encodeURIComponent(timezoneCity(tz))}&count=1&language=en&format=json`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json() as { results?: { latitude: number; longitude: number }[] }
    const hit = json.results?.[0]
    if (!hit) return null
    const coords = { lat: Number(hit.latitude.toFixed(3)), lon: Number(hit.longitude.toFixed(3)) }
    try { localStorage.setItem(PLACE_KEY, JSON.stringify({ ...places, [tz]: coords })) } catch { /* quota */ }
    return coords
  } catch { return null }
}

interface Cache { fetchedAt: number; tz: string; data: WeatherByHour }

/** Seven days of hourly temperature and conditions for the timezone in
 *  Settings, cached for an hour. Changing the timezone re-fetches. */
export async function loadWeather(): Promise<WeatherByHour> {
  const tz = settingsTimezone()
  const cached = readJson<Cache>(CACHE_KEY)
  const fresh = cached && cached.tz === tz && Date.now() - cached.fetchedAt < 3600_000
  if (fresh) return cached.data

  const coords = await coordsForTimezone(tz)
  if (!coords) return cached?.tz === tz ? cached.data : {}

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}`
      + `&hourly=temperature_2m,weather_code&forecast_days=7&timezone=${encodeURIComponent(tz)}`
    const res = await fetch(url)
    if (!res.ok) return cached?.tz === tz ? cached.data : {}
    const json = await res.json() as { hourly?: { time: string[]; temperature_2m: number[]; weather_code: number[] } }
    const h = json.hourly
    if (!h) return cached?.tz === tz ? cached.data : {}

    const data: WeatherByHour = {}
    h.time.forEach((t, i) => {
      // Open-Meteo returns "2026-09-01T14:00" already in the requested timezone
      data[t.slice(0, 13)] = { temp: Math.round(h.temperature_2m[i]), code: h.weather_code[i] }
    })
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), tz, data } satisfies Cache)) } catch { /* quota */ }
    return data
  } catch {
    return cached?.tz === tz ? cached.data : {}
  }
}

/** One glyph per kind of weather, from the WMO code Open-Meteo reports. */
export function weatherGlyph(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code === 45 || code === 48) return '🌫️'
  if (code >= 51 && code <= 57) return '🌦️'
  if (code >= 61 && code <= 67) return '🌧️'
  if (code >= 71 && code <= 77) return '🌨️'
  if (code >= 80 && code <= 82) return '🌧️'
  if (code >= 85 && code <= 86) return '🌨️'
  if (code >= 95) return '⛈️'
  return '☁️'
}

// ─── Timezone from where you actually are ────────────────────────────────────

/** Asks the browser where you are, then asks Open-Meteo which IANA zone that
 *  is. Nothing happens without you pressing the button — there is no silent
 *  location prompt anywhere in the app. Returns null if you decline, or if the
 *  lookup fails. */
export async function syncTimezoneFromLocation(): Promise<string | null> {
  const coords = await askBrowserLocation()
  if (!coords) return null
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}`
      + '&current=temperature_2m&timezone=auto'
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json() as { timezone?: string }
    const tz = json.timezone
    if (!tz) return null
    // Remember the exact spot, so the forecast is for here and not for the
    // zone's headline city.
    try { localStorage.setItem(SYNCED_KEY, JSON.stringify({ ...coords, tz })) } catch { /* quota */ }
    try { localStorage.removeItem(CACHE_KEY) } catch { /* quota */ }
    return tz
  } catch { return null }
}

function askBrowserLocation(): Promise<Coords | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null)
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: Number(pos.coords.latitude.toFixed(3)),
        lon: Number(pos.coords.longitude.toFixed(3)),
      }),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 },
    )
  })
}
