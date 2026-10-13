// ─── A book on the price watch ───────────────────────────────────────────────
// The watch itself is Shopping's: a watched book is an ordinary Shopping item in
// the "Books" category, and the existing function checks the stores for it. This
// file is the pure part — what to call the item, and what a price means against
// the target — plus the two actions that cross into the Shopping store.
import { supabase } from '@/lib/supabase'
import { baseCurrency } from '@/modules/finance/fx'
import { storesToCheck, useShoppingStore } from '@/modules/finance/shopping/shoppingStore'
import type { ShoppingItem } from '@/modules/finance/shopping/types'
import { useLibraryStore } from './libraryStore'
import type { Book } from './types'

export const WATCH_CATEGORY = 'Books'

/** What the shops are asked for. The title and the first author: an ISBN is more exact but the
 *  watcher searches by the item's name, and a bare number reads as nothing in the Shopping list. */
export const watchName = (b: Pick<Book, 'title' | 'authors'>): string => [b.title.trim(), b.authors[0]?.trim()].filter(Boolean).join(' ')

export type Verdict = 'none' | 'at-or-below' | 'above'
export function verdict(price: number | undefined, target: number | undefined): Verdict {
  if (price === undefined || target === undefined || !(target > 0)) return 'none'
  return Math.round(price * 100) <= Math.round(target * 100) ? 'at-or-below' : 'above'
}

export function checkedAgo(iso: string, now = Date.now()): string {
  const m = Math.floor((now - new Date(iso).getTime()) / 60000)
  if (!Number.isFinite(m) || m < 0) return 'just now'
  if (m < 2) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.floor(h / 24)} days ago`
}

/** Would any store you have be asked about a Books item? If not, a watch can never find a price. */
export function storesForBooks(): number {
  const { stores } = useShoppingStore.getState()
  return storesToCheck({ category: WATCH_CATEGORY, storeIds: [] } as unknown as ShoppingItem, stores).length
}

/** Starts watching: one Shopping item, then the pointer on the book. The pointer is written only once the item exists. */
export async function startWatch(book: Book, target: number | undefined, currency: string | undefined): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new Error('Not signed in')
  const item = useShoppingStore.getState().addItem({
    userId, name: watchName(book), category: WATCH_CATEGORY, quantity: 1, priority: 0, status: 'wanted',
    targetPriceMax: target, currency: currency || book.paidCurrency || baseCurrency(), sortOrder: 0,
    notes: `From your Library: “${book.title}”`,
  })
  useLibraryStore.getState().updateBook(book.id, { watchItemId: item.id })
  return item.id
}

/** Stops: takes the Shopping item (and its price history) away, and the pointer with it. */
export function stopWatch(book: Pick<Book, 'id' | 'watchItemId'>): void {
  if (book.watchItemId) useShoppingStore.getState().deleteItem(book.watchItemId)
  useLibraryStore.getState().updateBook(book.id, { watchItemId: undefined })
}
