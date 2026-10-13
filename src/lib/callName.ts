// ─── Being called by name ────────────────────────────────────────────────────
// Pure. "Beau, add milk to the list", "hey Beau what's on today", a bare "Beau",
// and — said aloud, where a speech engine hears "Bo" for "Beau" — all of them
// have to reach the assistant, and "Theo meeting notes" typed into the search
// box has to stay a search.
//
// So there are two readings, and the caller says which:
//   · **typed** (the search box): the name opens a request only when it is
//     *marked* as an address — a comma or colon after it, a greeting before it —
//     or when it is the whole input. A bare "Theo notes" is a search for notes.
//   · **voice**: nobody says punctuation, so a name at the start is enough, and
//     the engine's spelling is allowed one slip (`Bo` for `Beau` is two edits and
//     is *not* accepted; `Hadi` heard as `Hadi.` is). Fuzzy matching is only ever
//     allowed behind a greeting — "hey Ezra" — because "then" is one edit from
//     "Theo" and a whole sentence is full of near-misses.
//
// A name in the middle of a sentence is never an address: "I told Beau about it"
// is a sentence about Beau. A trailing ", Beau" is, typed, with its comma.
//
// Works in any script: matching is on letters, case-folded and with marks
// removed, and Arabic letter variants are folded (أ إ آ → ا, ى → ي, ة → ه).

export interface Address {
  addressed: boolean
  /** What was said after the name, trimmed; '' when only the name was said. */
  rest: string
  /** Only the name (and perhaps a greeting) — "I'm here", with nothing asked yet. */
  bare: boolean
}

const NONE: Address = { addressed: false, rest: '', bare: false }

const GREETINGS = new Set(['hey', 'hi', 'hello', 'ok', 'okay', 'yo', 'hola', 'يا', 'هاي', 'مرحبا', 'اهلا', 'هلا', 'ازيك'])

/** Ordinary words that are one slip from somebody's name ("then" is one edit from "Theo"). Never accepted as a near-miss. */
const COMMON = new Set(['then', 'them', 'they', 'the', 'this', 'that', 'there', 'what', 'when', 'with', 'will', 'well', 'wait', 'where', 'who', 'how', 'now', 'can', 'could', 'please', 'also', 'and', 'but', 'so', 'it', 'is', 'to', 'do', 'did', 'add', 'set', 'show', 'tell', 'give', 'make', 'open', 'see', 'look', 'find', 'check'])

export function fold(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/ـ/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
}

interface Tok { t: string; start: number; end: number }
function tokens(text: string): Tok[] {
  const out: Tok[] = []
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) out.push({ t: fold(m[0]).replace(/['’-]/g, ''), start: m.index!, end: m.index! + m[0].length })
  return out
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length]
}

const LEAD_PUNCT = /^[\s,:;!?.\-–—،]+/
const TRAIL_PUNCT = /[\s,:;!?.\-–—،]+$/

export function addressedTo(text: string, name: string, opts: { voice?: boolean } = {}): Address {
  const nameToks = tokens(name)
  const toks = tokens(text)
  if (!nameToks.length || !toks.length) return NONE
  const n = nameToks.length

  let i = 0
  while (i < toks.length - n && i < 2 && GREETINGS.has(toks[i].t)) i++
  const greeted = i > 0

  const exact = nameToks.every((nt, k) => toks[i + k]?.t === nt.t)
  const near = !exact && greeted && !!opts.voice && nameToks.every((nt, k) => {
    const w = toks[i + k]?.t
    return !!w && (w === nt.t || (nt.t.length >= 4 && !COMMON.has(w) && editDistance(w, nt.t) <= 1))
  })
  if (exact || near) {
    const last = toks[i + n - 1]
    const afterRaw = text.slice(last.end)
    const marked = /^\s*[,:;،—–-]/.test(afterRaw) || /^\s*[!?.]?\s*$/.test(afterRaw)
    // Typed, an unmarked "Theo meeting notes" is a search, not an address — unless a greeting marked it.
    if (!opts.voice && !greeted && !marked) return NONE
    const rest = afterRaw.replace(LEAD_PUNCT, '').trim()
    return { addressed: true, rest, bare: rest === '' }
  }

  // Typed only: "add milk, Beau" — the comma is what says it is a name being called.
  if (!opts.voice && toks.length > n) {
    const start = toks.length - n
    if (nameToks.every((nt, k) => toks[start + k].t === nt.t)) {
      const before = text.slice(0, toks[start].start)
      if (/[,،]\s*$/.test(before) && /^[\s!?.]*$/.test(text.slice(toks[toks.length - 1].end))) {
        const rest = before.replace(TRAIL_PUNCT, '').trim()
        if (rest) return { addressed: true, rest, bare: false }
      }
    }
  }
  return NONE
}
