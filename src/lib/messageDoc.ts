// ─── The document a message is drawn in ──────────────────────────────────────
// Three screens showed a mail body in a sandboxed iframe and each built its own
// `<!doctype html>` by hand, so the three had already drifted: different
// padding, different colours, two of them reaching for `var(--sb-ink-1)` and
// `var(--sb-info)` — which a sandboxed frame cannot see, the parent's custom
// properties not crossing that boundary, so those rules resolved to nothing and
// always had. One builder, and a fix reaches all three.

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
function escapeHtml(s: string): string { return s.replace(/[&<>]/g, c => ESC[c]) }

export interface MessageDocOptions {
  /** The frame's own inset. Each caller sits in a differently padded column. */
  padding?: string
}

const BLOCKS = 'p,div,li,ul,ol,td,th,dl,dd,blockquote,pre,h1,h2,h3,h4,h5,h6,section,article,figure,address'

/**
 * Give every block its own `dir="auto"`, so each one resolves its direction
 * from its own first strong character.
 *
 * **Why not CSS alone.** `unicode-bidi: plaintext` reorders the *text* inside a
 * block correctly, and stops there: the computed `direction` stays `ltr`, so
 * everything the box hangs off that property is still left-handed — the list
 * marker, the quote rule, `text-align: start`. An Arabic list came out with its
 * numbers on the left of right-to-left text, which is what the screen showed.
 * `dir` is the property those read, so `dir` is what has to be set.
 *
 * **Why not one `dir="auto"` on `<body>`.** It takes the first strong character
 * of the whole document and applies that verdict to all of it. Business mail
 * here opens with an English heading, so the whole message would stay left to
 * right and every Arabic paragraph under it would stay broken.
 *
 * Parsing is `DOMParser`, which builds a tree without running a script or
 * fetching a resource — the same reason it is the safe way to read somebody
 * else's HTML. A block that already carries a `dir` is left alone: the sender
 * said what they meant.
 */
function markDirection(html: string): string {
  if (typeof DOMParser === 'undefined') return html
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    for (const el of Array.from(doc.body.querySelectorAll(BLOCKS))) {
      if (!el.hasAttribute('dir')) el.setAttribute('dir', 'auto')
    }
    return doc.body.innerHTML
  } catch { return html }
}

/**
 * Build the document for one message body.
 *
 * A mail body arrives as somebody else's HTML with no `dir` on anything, so the
 * frame's own direction decided it — left to right — for all of it. Arabic then
 * rendered with its full stops at the *start* of the line and its list markers
 * on the wrong side: the characters were right, their order was not.
 *
 * `text-align` is deliberately never set: its initial value is `start`, which
 * follows whatever direction each block just resolved to. A message that sets
 * `text-align: left` inline is left alone — it asked for that, and overriding
 * it would break every deliberately left-aligned layout to fix the ones that
 * said nothing.
 */
export function messageDoc(html: string | null, text: string, opts: MessageDocOptions = {}): string {
  const body = html
    ? markDirection(html)
    : `<pre dir="auto" style="white-space:pre-wrap;font:inherit;margin:0">${escapeHtml(text)}</pre>`
  return `<!doctype html><html><head><meta charset="utf-8">
      <base target="_blank">
      <style>
        html,body{margin:0;padding:${opts.padding ?? '0'};background:transparent;
          font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#191712;
          word-wrap:break-word;overflow-wrap:anywhere}
        /* The backstop, for text sitting straight in the body with no block of
           its own to carry a dir, and for a pre whose lines each decide for
           themselves — a newline is a paragraph separator to the bidi
           algorithm. It orders the text; dir above is what moves the boxes. */
        body,pre{unicode-bidi:plaintext}
        img{max-width:100%;height:auto}
        table{max-width:100%}
        a{color:#0B63C5}
        /* Logical, not left: the quote rule belongs on the side the text starts
           from, which in an Arabic reply is the right. This only lands because
           each blockquote now carries a real dir. */
        blockquote{margin:0;margin-inline-start:10px;padding-inline-start:10px;
          border-inline-start:2px solid #E8E1CE;color:#6C6553}
        pre{white-space:pre-wrap}
      </style></head><body>${body}</body></html>`
}
