import { useMemo } from 'react'
import { Card, Button } from '@/components/ui'
import { useHeldText } from '@/lib/useHeldText'
import { Eyebrow, Field, DateField, Row, TextField } from './fields'
import { inputStyle } from './fieldStyle'
import { useLibraryStore } from './libraryStore'
import { todayISO } from './readingStats'
import { fmtMoney, parseCurrency, parseMoney } from './spendStats'
import type { Book } from './types'

// Every currency this browser knows, not a typed list of three.
const currencies = (): string[] => {
  try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('currency') ?? [] } catch { return [] }
}

/**
 * What it cost, and where and when it was bought. Four plain facts on the book:
 * they are never converted into one currency (the totals on the Tracker are
 * per currency), and nothing here touches Finance.
 *
 * It is pre-answered: the first price typed brings today's date and the
 * currency of the last book you priced, both visible and editable, so the work
 * is correcting rather than filling.
 */
export function PurchaseCard({ book }: { book: Book }) {
  const update = useLibraryStore(s => s.updateBook)
  const books = useLibraryStore(s => s.books)
  const list = useMemo(() => currencies(), [])
  const lastCurrency = useMemo(() => books.filter(b => b.paidCurrency && b.boughtOn).sort((a, b) => (b.boughtOn! > a.boughtOn! ? 1 : -1))[0]?.paidCurrency, [books])

  const money = useHeldText(book.paidAmount === undefined ? '' : String(book.paidAmount), v => {
    if (!v.trim()) return update(book.id, { paidAmount: undefined })
    const n = parseMoney(v)
    if (n === null) return
    update(book.id, { paidAmount: n, paidCurrency: book.paidCurrency ?? lastCurrency, boughtOn: book.boughtOn ?? todayISO() })
  })
  const cur = useHeldText(book.paidCurrency ?? '', v => {
    if (!v.trim()) return update(book.id, { paidCurrency: undefined })
    const c = parseCurrency(v)
    if (c) update(book.id, { paidCurrency: c })
  })
  const badMoney = money.text.trim() !== '' && parseMoney(money.text) === null
  const badCur = cur.text.trim() !== '' && parseCurrency(cur.text) === null
  const incomplete = book.paidAmount !== undefined && (!book.paidCurrency || !book.boughtOn)

  return (
    <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Eyebrow>What it cost</Eyebrow>
      <Row>
        <Field label="Paid" grow={2}>
          <input value={money.text} inputMode="decimal" placeholder="0.00" aria-label="Price paid" aria-invalid={badMoney}
            onChange={e => money.onChange(e.target.value)} onBlur={money.onBlur}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} style={inputStyle} />
        </Field>
        <Field label="Currency" grow={1}>
          <input value={cur.text} list="library-currencies" placeholder="EGP" aria-label="Currency" aria-invalid={badCur} maxLength={3}
            onChange={e => cur.onChange(e.target.value.toUpperCase())} onBlur={cur.onBlur}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} style={inputStyle} />
          <datalist id="library-currencies">{list.map(c => <option key={c} value={c} />)}</datalist>
        </Field>
      </Row>
      {(badMoney || badCur) && <div role="alert" style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-accent-deep)' }}>
        {badMoney ? 'That is not an amount — use digits, like 249.50.' : 'A currency is three letters, like EGP or USD.'} Nothing was saved.
      </div>}
      <Row>
        <DateField label="Bought on" value={book.boughtOn} onPush={boughtOn => update(book.id, { boughtOn })} />
        <TextField label="Bought at" value={book.boughtAt ?? ''} placeholder="Shop or person" onPush={v => update(book.id, { boughtAt: v.trim() || undefined })} />
      </Row>
      {incomplete && <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Add {!book.paidCurrency ? 'a currency' : ''}{!book.paidCurrency && !book.boughtOn ? ' and ' : ''}{!book.boughtOn ? 'the day you bought it' : ''} to count this in the year’s spending.</div>}
      {book.paidAmount !== undefined && book.paidCurrency && (
        <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{fmtMoney(book.paidAmount, book.paidCurrency)}</div>
      )}
      {book.toBuy && book.paidAmount !== undefined && (
        <Button size="sm" variant="secondary" style={{ alignSelf: 'flex-start' }} onClick={() => update(book.id, { toBuy: false })}>
          Bought it — take it off the buy list
        </Button>
      )}
    </Card>
  )
}
