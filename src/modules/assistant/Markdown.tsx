import { useState, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useHabitsStore } from '@/store/habitsStore'

// The assistant writes Markdown — tables, lists, bold — and the bubble used to
// print it as characters (`###`, `| Time | Event |`). This draws it instead.
//
// **No raw HTML, ever.** react-markdown does not parse HTML in the source unless
// a plugin is added, and none is: what the model writes is data from a stranger
// as far as the page is concerned, and a tag in it is text. `urlTransform`
// (default) drops `javascript:` and friends from links and images.
//
// **Every colour is a token**, so the four themes need nothing here. The panel
// is ~390px, so a table scrolls sideways inside its own box rather than
// stretching the bubble, and headings step down: an H1 at page size inside a
// chat bubble is a shout.

const CSS = `
.ai-md { font-size: var(--sb-t-body-s); line-height: 1.55; color: inherit; overflow-wrap: anywhere; }
.ai-md > :first-child { margin-top: 0 }
.ai-md > :last-child  { margin-bottom: 0 }
.ai-md p  { margin: 0 0 8px }
.ai-md h1, .ai-md h2, .ai-md h3, .ai-md h4 {
  margin: 12px 0 5px; line-height: 1.3; font-weight: 600; font-family: var(--sb-font-head, inherit);
}
.ai-md h1 { font-size: 1.12em } .ai-md h2 { font-size: 1.06em } .ai-md h3, .ai-md h4 { font-size: 1em }
.ai-md ul, .ai-md ol { margin: 0 0 8px; padding-left: 20px }
.ai-md ul { list-style: disc } .ai-md ol { list-style: decimal } .ai-md ul ul { list-style: circle }
.ai-md li { margin: 2px 0 } .ai-md li > p { margin: 0 }
.ai-md a { color: var(--sb-accent-deep); text-decoration: underline; text-underline-offset: 2px }
.ai-md strong { font-weight: 650 }
.ai-md hr { border: 0; border-top: var(--sb-border-width) solid var(--sb-hairline); margin: 10px 0 }
.ai-md blockquote {
  margin: 0 0 8px; padding: 2px 0 2px 10px;
  border-left: 3px solid var(--sb-border); color: var(--sb-ink-3);
}
.ai-md code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92em;
  padding: 1px 5px; border-radius: var(--sb-r-chip);
  background: color-mix(in srgb, var(--sb-ink-1) 8%, transparent);
}
.ai-md pre {
  margin: 0 0 8px; padding: 9px 11px; overflow-x: auto;
  border-radius: var(--sb-r-nav); border: var(--sb-border-width) solid var(--sb-border);
  background: color-mix(in srgb, var(--sb-ink-1) 5%, transparent);
}
.ai-md pre code { padding: 0; background: none; font-size: .88em }
.ai-md .ai-md-table {
  margin: 0 0 8px; overflow-x: auto; max-width: 100%;
  border: var(--sb-border-width) solid var(--sb-border); border-radius: var(--sb-r-nav);
}
.ai-md table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: var(--sb-t-meta) }
.ai-md th, .ai-md td {
  padding: 6px 10px; text-align: left; vertical-align: top;
  border-bottom: var(--sb-border-width) solid var(--sb-hairline);
}
.ai-md th { font-weight: 600; white-space: nowrap; border-bottom-color: var(--sb-border) }
.ai-md tr:last-child td { border-bottom: 0 }
.ai-md td { min-width: 64px }
.ai-md img.ai-md-habit { display: inline-block; width: 28px; height: 28px; margin: 0 8px 0 0; vertical-align: middle; object-fit: cover; border-radius: var(--sb-r-chip); border: var(--sb-border-width) solid var(--sb-border) }
.ai-md img { display: block; max-width: 100%; height: auto; border-radius: var(--sb-r-nav); margin: 4px 0 }
`

/** `![Water](habit:<id>)` — the model names a habit's picture, the app draws
 *  it. The photo is a ~60KB data URL: handing it through the model would cost
 *  the tokens and a model cannot be trusted to copy that many characters back
 *  out, so what crosses is a reference of a dozen characters and the real
 *  image is read from the store here. No photo → the habit's own emoji, never
 *  a broken box. */
function HabitPicture({ id, alt }: { id: string; alt?: string }) {
  const habit = useHabitsStore(s => s.habits.find(h => h.id === id))
  if (!habit) return <span>{alt ?? ''}</span>
  if (habit.image) return <img className="ai-md-habit" src={habit.image} alt={alt || habit.name} />
  return <span style={{ marginRight: 8 }} aria-label={alt || habit.name}>{habit.emoji}</span>
}

function Img({ src, alt }: { src?: string; alt?: string }) {
  const [dead, setDead] = useState(false)
  if (src?.startsWith('habit:')) return <HabitPicture id={src.slice(6)} alt={alt} />
  // A broken picture is a grey box with no explanation; say what it was.
  if (!src || dead) return <a href={src} target="_blank" rel="noopener noreferrer">{alt || 'image'}</a>
  return <img src={src} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" onError={() => setDead(true)} />
}

const components: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children as ReactNode}</a>,
  table: ({ children }) => <div className="ai-md-table"><table>{children}</table></div>,
  img: ({ src, alt }) => <Img src={typeof src === 'string' ? src : undefined} alt={alt} />,
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="ai-md">
      <style>{CSS}</style>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}
        // `habit:` is ours and carries no URL; everything else keeps the default filter.
        urlTransform={u => (u.startsWith('habit:') ? u : defaultUrlTransform(u))}>{text}</ReactMarkdown>
    </div>
  )
}
