// Shopping List — Supabase DB helpers
// Same pattern as financeDb.ts: immediate writes, no debounce.
// Column drops on error: the migration may not have run on all environments.

import { supabase } from '@/lib/supabase'
import type { ShoppingGroup, ShoppingItem, ShoppingStore, PriceSnapshot } from './types'

// ─── Row shapes (snake_case ↔ camelCase) ─────────────────────────────────────

interface GroupRow {
  id: string; user_id: string; name: string; color: string; icon: string
  scheduled_date?: string | null; recurrence: string; recurrence_rule?: string | null
  next_run_at?: string | null; status: string; sort_order: number
  created_at: string; updated_at: string
}

interface ItemRow {
  id: string; user_id: string; group_id?: string | null; name: string; category: string
  quantity: number; unit?: string | null; priority: number; status: string
  target_price_max?: number | null; currency: string; budget_envelope_id?: string | null
  calendar_event_id?: string | null; task_id?: string | null; notes?: string | null
  purchased_at?: string | null; final_price?: number | null; store_used_id?: string | null
  sort_order: number; created_at: string; updated_at: string
}

interface StoreRow {
  id: string; user_id: string; name: string; url: string; country?: string | null
  categories: string[]; last_scraped_at?: string | null; last_scrape_ok?: boolean | null
  sort_order: number; created_at: string; updated_at: string
}

interface SnapshotRow {
  id: string; item_id: string; store_id: string; price: number; currency: string
  product_url?: string | null; available: boolean; scraped_at: string
}

// ─── Row → Model converters ───────────────────────────────────────────────────

function toGroup(r: GroupRow): ShoppingGroup {
  return {
    id: r.id, userId: r.user_id, name: r.name, color: r.color, icon: r.icon,
    scheduledDate: r.scheduled_date ?? undefined,
    recurrence: r.recurrence as ShoppingGroup['recurrence'],
    recurrenceRule: r.recurrence_rule ?? undefined,
    nextRunAt: r.next_run_at ?? undefined,
    status: r.status as ShoppingGroup['status'],
    sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

function toItem(r: ItemRow): ShoppingItem {
  return {
    id: r.id, userId: r.user_id, groupId: r.group_id ?? undefined,
    name: r.name, category: r.category, quantity: r.quantity,
    unit: r.unit ?? undefined, priority: r.priority,
    status: r.status as ShoppingItem['status'],
    targetPriceMax: r.target_price_max ?? undefined,
    currency: r.currency,
    budgetEnvelopeId: r.budget_envelope_id ?? undefined,
    calendarEventId: r.calendar_event_id ?? undefined,
    taskId: r.task_id ?? undefined,
    notes: r.notes ?? undefined,
    purchasedAt: r.purchased_at ?? undefined,
    finalPrice: r.final_price ?? undefined,
    storeUsedId: r.store_used_id ?? undefined,
    sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

function toStore(r: StoreRow): ShoppingStore {
  return {
    id: r.id, userId: r.user_id, name: r.name, url: r.url,
    country: r.country ?? undefined, categories: r.categories,
    lastScrapedAt: r.last_scraped_at ?? undefined,
    lastScrapeOk: r.last_scrape_ok ?? undefined,
    sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

function toSnapshot(r: SnapshotRow): PriceSnapshot {
  return {
    id: r.id, itemId: r.item_id, storeId: r.store_id, price: r.price,
    currency: r.currency, productUrl: r.product_url ?? undefined,
    available: r.available, scrapedAt: r.scraped_at,
  }
}

// ─── Groups ───────────────────────────────────────────────────────────────────

export async function loadGroups(): Promise<ShoppingGroup[] | null> {
  const { data, error } = await supabase
    .from('shopping_groups')
    .select('*')
    .order('sort_order')
  if (error) { console.warn('[shoppingDb] loadGroups:', error.message); return null }
  return (data as GroupRow[]).map(toGroup)
}

export async function upsertGroup(g: Partial<ShoppingGroup> & { id: string; userId: string }): Promise<void> {
  const { error } = await supabase.from('shopping_groups').upsert({
    id: g.id, user_id: g.userId, name: g.name ?? 'New List',
    color: g.color ?? '#F5D14E', icon: g.icon ?? '🛒',
    scheduled_date: g.scheduledDate ?? null,
    recurrence: g.recurrence ?? 'none',
    recurrence_rule: g.recurrenceRule ?? null,
    next_run_at: g.nextRunAt ?? null,
    status: g.status ?? 'active',
    sort_order: g.sortOrder ?? 0,
    updated_at: new Date().toISOString(),
  })
  if (error) console.warn('[shoppingDb] upsertGroup:', error.message)
}

export async function deleteGroup(id: string): Promise<void> {
  const { error } = await supabase.from('shopping_groups').delete().eq('id', id)
  if (error) console.warn('[shoppingDb] deleteGroup:', error.message)
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function loadItems(): Promise<ShoppingItem[] | null> {
  const { data, error } = await supabase
    .from('shopping_items')
    .select('*')
    .order('sort_order')
  if (error) { console.warn('[shoppingDb] loadItems:', error.message); return null }
  return (data as ItemRow[]).map(toItem)
}

export async function upsertItem(item: Partial<ShoppingItem> & { id: string; userId: string; name: string }): Promise<void> {
  const row = {
    id: item.id, user_id: item.userId, group_id: item.groupId ?? null,
    name: item.name, category: item.category ?? 'General',
    quantity: item.quantity ?? 1, unit: item.unit ?? null,
    priority: item.priority ?? 0, status: item.status ?? 'wanted',
    target_price_max: item.targetPriceMax ?? null,
    currency: item.currency ?? 'EGP',
    budget_envelope_id: item.budgetEnvelopeId ?? null,
    calendar_event_id: item.calendarEventId ?? null,
    task_id: item.taskId ?? null,
    notes: item.notes ?? null,
    purchased_at: item.purchasedAt ?? null,
    final_price: item.finalPrice ?? null,
    store_used_id: item.storeUsedId ?? null,
    sort_order: item.sortOrder ?? 0,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('shopping_items').upsert(row)
  if (error) console.warn('[shoppingDb] upsertItem:', error.message)
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('shopping_items').delete().eq('id', id)
  if (error) console.warn('[shoppingDb] deleteItem:', error.message)
}

// ─── Stores ───────────────────────────────────────────────────────────────────

export async function loadStores(): Promise<ShoppingStore[] | null> {
  const { data, error } = await supabase
    .from('shopping_stores')
    .select('*')
    .order('sort_order')
  if (error) { console.warn('[shoppingDb] loadStores:', error.message); return null }
  return (data as StoreRow[]).map(toStore)
}

export async function upsertStore(s: Partial<ShoppingStore> & { id: string; userId: string; name: string; url: string }): Promise<void> {
  const { error } = await supabase.from('shopping_stores').upsert({
    id: s.id, user_id: s.userId, name: s.name, url: s.url,
    country: s.country ?? null,
    categories: s.categories ?? [],
    sort_order: s.sortOrder ?? 0,
    updated_at: new Date().toISOString(),
  })
  if (error) console.warn('[shoppingDb] upsertStore:', error.message)
}

export async function deleteStore(id: string): Promise<void> {
  const { error } = await supabase.from('shopping_stores').delete().eq('id', id)
  if (error) console.warn('[shoppingDb] deleteStore:', error.message)
}

export async function markStoreScraped(id: string, ok: boolean): Promise<void> {
  const { error } = await supabase.from('shopping_stores').update({
    last_scraped_at: new Date().toISOString(),
    last_scrape_ok: ok,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) console.warn('[shoppingDb] markStoreScraped:', error.message)
}

// ─── Price snapshots ──────────────────────────────────────────────────────────

export async function loadSnapshots(itemIds: string[]): Promise<PriceSnapshot[] | null> {
  if (!itemIds.length) return []
  const { data, error } = await supabase
    .from('shopping_price_snapshots')
    .select('*')
    .in('item_id', itemIds)
    .order('scraped_at', { ascending: false })
  if (error) { console.warn('[shoppingDb] loadSnapshots:', error.message); return null }
  return (data as SnapshotRow[]).map(toSnapshot)
}

export async function insertSnapshot(s: Omit<PriceSnapshot, 'id'>): Promise<void> {
  const { error } = await supabase.from('shopping_price_snapshots').insert({
    item_id: s.itemId, store_id: s.storeId, price: s.price,
    currency: s.currency, product_url: s.productUrl ?? null,
    available: s.available, scraped_at: s.scrapedAt,
  })
  if (error) console.warn('[shoppingDb] insertSnapshot:', error.message)
}
