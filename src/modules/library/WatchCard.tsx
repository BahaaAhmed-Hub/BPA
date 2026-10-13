import { useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { moduleIsOff } from '@/lib/entitlements'
import { notify } from '@/lib/undo'
import { baseCurrency } from '@/modules/finance/fx'
import { isLocked } from '@/modules/finance/lock'
import { useShoppingStore } from '@/modules/finance/shopping/shoppingStore'
import { Eyebrow, Field, Row } from './fields'
import { inputStyle } from './fieldStyle'
import { useHeldText } from '@/lib/useHeldText'
import { watchSupported } from './libraryDb'
import { useLibraryStore } from './libraryStore'
import { checkedAgo, startWatch, stopWatch, storesForBooks, verdict, WATCH_CATEGORY } from './priceWatch'
import { fmtMoney, parseCurrency, parseMoney } from './spendStats'
import type { Book } from './types'

const Note = ({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) => (
  <div style={{ fontSize: 'var(--sb-t-meta)', lineHeight: 1.45, color: tone === 'warn' ? 'var(--sb-accent-deep)' : 'var(--sb-ink-3)' }}>{children}</div>
)

/**
 * Watch this book's price. The watch is Shopping's — a watched book is one
 * Shopping item in "Books" and the existing price check does the rest — so this
 * card exists only when Shopping can be read: Finance on for this plan, and not
 * behind its lock (a tab of Finance is not read around its door).
 *
 * The prices are what each shop's own search returned first, which can be
 * another edition of the book; the card says so rather than presenting a
 * match as a fact.
 */
export function WatchCard({ book }: { book: Book }) {
  const update = useLibraryStore(s => s.updateBook)
  const items = useShoppingStore(s => s.items)
  const snapshots = useShoppingStore(s => s.snapshots)
  const stores = useShoppingStore(s => s.stores)
  const loaded = useShoppingStore(s => s.loaded)
  const loading = useShoppingStore(s => s.loading)
  const enabled = useShoppingStore(s => s.settings.enabled)
  const busy = useShoppingStore(s => s.priceWatchLoading)
  const [confirming, setConfirming] = useState(false)
  const [starting, setStarting] = useState(false)
  const off = moduleIsOff('finance')
  const locked = !off && isLocked()
  const usable = !off && !locked

  const [supported, setSupported] = useState<boolean | null>(null)
  useEffect(() => { if (usable) void watchSupported().then(setSupported) }, [usable])
  useEffect(() => { if (usable && !loaded && !loading) void useShoppingStore.getState().loadAll() }, [usable, loaded, loading])

  const item = book.watchItemId ? items.find(i => i.id === book.watchItemId) : undefined
  const enriched = useMemo(() => (item ? useShoppingStore.getState().enrichedItems().find(i => i.id === item.id) : undefined), [item, snapshots, stores]) // eslint-disable-line react-hooks/exhaustive-deps
  const best = enriched?.bestPrice

  const [draftTarget, setDraftTarget] = useState('')
  const [draftCur, setDraftCur] = useState('')
  const target = useHeldText(item?.targetPriceMax === undefined ? '' : String(item.targetPriceMax), v => {
    if (!item) return
    if (!v.trim()) return useShoppingStore.getState().updateItem(item.id, { targetPriceMax: undefined })
    const n = parseMoney(v)
    if (n !== null) useShoppingStore.getState().updateItem(item.id, { targetPriceMax: n })
  })
  const badTarget = item && target.text.trim() !== '' && parseMoney(target.text) === null

  const shell = (children: React.ReactNode) => (
    <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Eyebrow>Watch the price</Eyebrow>
      {children}
    </Card>
  )

  if (off) return shell(<Note>Price watching uses Shopping, which is part of Finance — and Finance is not on your plan.</Note>)
  if (locked) return shell(<Note>Shopping sits behind the Finance lock. Open Finance and unlock it, then come back to watch this book’s price.</Note>)
  if (!loaded && !book.watchItemId) return shell(<Note>Reading your shopping list…</Note>)

  // ── already watching ─────────────────────────────────────────────────────
  if (book.watchItemId) {
    if (!loaded) return shell(<Note>Reading your shopping list…</Note>)
    if (!item) {
      return shell(<>
        <Note tone="warn">The Shopping item that watched this book has been removed, so nothing is checking its price.</Note>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button size="sm" variant="secondary" onClick={() => update(book.id, { watchItemId: undefined })}>Forget it</Button>
        </div>
      </>)
    }
    const v = verdict(best?.price, item.targetPriceMax)
    const noStore = storesForBooks() === 0 && !(item.storeIds ?? []).length
    return shell(<>
      {best ? (
        <div>
          <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>
            {fmtMoney(best.price, best.currency)}
            {v !== 'none' && <span style={{ marginLeft: 8, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: v === 'at-or-below' ? 'var(--sb-positive)' : 'var(--sb-ink-3)' }}>
              {v === 'at-or-below' ? 'at or under your target' : 'above your target'}
            </span>}
          </div>
          <Note>
            {best.storeName} · checked {checkedAgo(best.scrapedAt)}
            {best.productUrl && <> · <a href={best.productUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>open the shop’s page <ExternalLink size={11} aria-hidden style={{ verticalAlign: -1 }} /></a></>}
          </Note>
        </div>
      ) : <Note>No price seen yet.</Note>}
      <Row>
        <Field label={`Tell me at or under (${item.currency})`}>
          <input value={target.text} inputMode="decimal" placeholder="no target" aria-label="Target price" aria-invalid={!!badTarget}
            onChange={e => target.onChange(e.target.value)} onBlur={target.onBlur}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} style={inputStyle} />
        </Field>
      </Row>
      {badTarget && <div role="alert" style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-accent-deep)' }}>That is not an amount — nothing was saved.</div>}
      {noStore && <Note tone="warn">No store in Shopping is set to check “{WATCH_CATEGORY}”, so no price can be found. Add a bookshop under Shopping → Stores with that category.</Note>}
      {!enabled && <Note tone="warn">The price watch is switched off in Shopping, so nothing will be checked.</Note>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="sm" variant="secondary" disabled={busy || !enabled}
          onClick={() => void useShoppingStore.getState().refreshPrices([item.id])}>{busy ? 'Checking…' : 'Check now'}</Button>
        {!enabled && <Button size="sm" variant="secondary" onClick={() => useShoppingStore.getState().updateSettings({ enabled: true })}>Switch the watch on</Button>}
        {confirming ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => { stopWatch(book); setConfirming(false) }}>Yes, stop and remove it from Shopping</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep watching</Button>
          </>
        ) : <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>Stop watching</Button>}
      </div>
      <Note>It shows the first match each shop’s own search returns, which can be a different edition — open the page before you buy. Watching also lists it in Shopping under “{WATCH_CATEGORY}”.</Note>
    </>)
  }

  // ── not watching ─────────────────────────────────────────────────────────
  if (supported === false) return shell(<Note tone="warn">Watching a book’s price needs the database update <code>20260036_library_watch.sql</code>. Nothing was added to Shopping.</Note>)
  const cur = draftCur || book.paidCurrency || baseCurrency()
  const tv = draftTarget.trim() ? parseMoney(draftTarget) : undefined
  const bad = (draftTarget.trim() !== '' && tv === null) || (draftCur.trim() !== '' && !parseCurrency(draftCur))
  const go = async () => {
    setStarting(true)
    try { await startWatch(book, tv ?? undefined, parseCurrency(cur) ?? undefined); notify('Watching the price of “' + book.title + '”') }
    catch (e) { notify(`Could not start the watch — ${e instanceof Error ? e.message : 'try again'}`) }
    finally { setStarting(false) }
  }
  return shell(<>
    <Row>
      <Field label="Tell me at or under" grow={2}>
        <input value={draftTarget} inputMode="decimal" placeholder="optional" aria-label="Target price" aria-invalid={bad}
          onChange={e => setDraftTarget(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Currency" grow={1}>
        <input value={draftCur || cur} maxLength={3} aria-label="Target currency" onChange={e => setDraftCur(e.target.value.toUpperCase())} style={inputStyle} />
      </Field>
    </Row>
    {bad && <div role="alert" style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-accent-deep)' }}>Use digits for the price, and three letters for the currency.</div>}
    {storesForBooks() === 0 && loaded && <Note tone="warn">No store in Shopping is set to check “{WATCH_CATEGORY}” yet — add a bookshop under Shopping → Stores with that category, or no price will be found.</Note>}
    <Button size="sm" variant="secondary" disabled={bad || starting || supported !== true} style={{ alignSelf: 'flex-start' }} onClick={() => void go()}>
      {starting ? 'Starting…' : 'Watch this book’s price'}
    </Button>
    <Note>This adds the book to your Shopping list under “{WATCH_CATEGORY}”, where the price check already runs.</Note>
  </>)
}
