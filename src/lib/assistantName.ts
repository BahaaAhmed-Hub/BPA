// The one rule for what a name may be — pure, so the matcher and its tests can use it without the app around it.
export const NAME_MAX = 24

/** Letters (any script), digits, space, hyphen, apostrophe, full stop — nothing else survives. */
export function cleanName(raw: string): string {
  const t = (raw ?? '').normalize('NFKC').replace(/[^\p{L}\p{N}\s'’.-]/gu, '').replace(/\s+/g, ' ').trim()
  return t.slice(0, NAME_MAX).trim()
}
