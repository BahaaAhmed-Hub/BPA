// Shopping List — Zustand store
// Live state for groups, items, stores, and price snapshots.
// Follows the same patterns as financeStore: immediate DB writes,
// optimistic local updates, Realtime subscription for cross-device sync.

import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import * as db from './shoppingDb'
import type { ShoppingGroup, ShoppingItem, ShoppingStore, PriceSnapshot, PriceSummary, ShoppingSettings, ShoppingPriceWatchFrequency } from './types'
import { DEFAULT_SHOPPING_SETTINGS } from './types'

function newId() {
  return crypto.randomUUID()
}

function loadSettings(): ShoppingSettings {
  try {
    const raw = localStorage.getItem('shopping-settings')
    return raw ? { ...DEFAULT_SHOPPING_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SHOPPING_SETTINGS
  } catch {
    return DEFAULT_SHOPPING_SETTINGS
  }
}

function saveSettings(s: ShoppingSettings) {
  try { localStorage.setItem('shopping-settings', JSON.stringify(s)) } catch { /* noop */ }
}

// ─── Best-price computation ───────────────────────────────────────────────────

function computeBestPrice(itemId: string, snapshots: PriceSnapshot[], stores: ShoppingStore[]): PriceSummary | undefined {
  const relevant = snapshots
    .filter(s => s.itemId === itemId && s.available)
    .sort((a, b) => a.price - b.price)
  if (!relevant.length) return undefined
  const best = relevant[0]
  const store = stores.find(s => s.id === best.storeId)
  if (!store) return undefined
  return {
    price: best.price, currency: best.currency,
    storeId: best.storeId, storeName: store.name,
    productUrl: best.productUrl, scrapedAt: best.scrapedAt,
  }
}

function computeSuggestedStores(item: ShoppingItem, stores: ShoppingStore[]): string[] {
  return stores
    .filter(s => s.categories.includes(item.category))
    .map(s => s.id)
}

/**
 * The stores this item actually gets checked at — **the one answer**, used by
 * the price watch, by the trip order and by the picker that draws it.
 *
 * Your own choice wins where you have made one; where you have not, the
 * category match stands in. Those are two different questions and used to be
 * one field: the picker wrote `suggestedStores`, which `enrichItems` recomputed
 * from the category on the very next render, and the price watch re-derived the
 * category match itself rather than reading either. So the pills reset and
 * changed nothing in between.
 */
export function storesToCheck(item: ShoppingItem, stores: ShoppingStore[]): ShoppingStore[] {
  const chosen = item.storeIds ?? []
  if (chosen.length) {
    // A store deleted since the choice was made is simply gone from it.
    const kept = stores.filter(s => chosen.includes(s.id))
    if (kept.length) return kept
  }
  return stores.filter(s => s.categories.includes(item.category))
}

function enrichItems(items: ShoppingItem[], snapshots: PriceSnapshot[], stores: ShoppingStore[]): ShoppingItem[] {
  return items.map(item => ({
    ...item,
    bestPrice: computeBestPrice(item.id, snapshots, stores),
    priceHistory: snapshots.filter(s => s.itemId === item.id).sort((a, b) => new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime()),
    // Derived only. `storeIds` — what you picked — is left exactly as it came.
    suggestedStores: computeSuggestedStores(item, stores),
  }))
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface ShoppingState {
  groups:    ShoppingGroup[]
  items:     ShoppingItem[]
  stores:    ShoppingStore[]
  snapshots: PriceSnapshot[]
  loading:   boolean
  settings:  ShoppingSettings

  // Computed convenience
  enrichedItems: () => ShoppingItem[]

  // Load
  loadAll:   () => Promise<void>

  // Groups
  addGroup:    (g: Omit<ShoppingGroup, 'id' | 'createdAt' | 'updatedAt'>) => ShoppingGroup
  updateGroup: (id: string, patch: Partial<ShoppingGroup>) => void
  deleteGroup: (id: string) => void
  archiveGroup:(id: string) => void

  // Items
  addItem:    (item: Omit<ShoppingItem, 'id' | 'createdAt' | 'updatedAt'>) => ShoppingItem
  updateItem: (id: string, patch: Partial<ShoppingItem>) => void
  deleteItem: (id: string) => void
  purchaseItem:(id: string, finalPrice?: number, storeId?: string) => void

  // Stores
  addStore:    (s: Omit<ShoppingStore, 'id' | 'createdAt' | 'updatedAt'>) => ShoppingStore
  updateStore: (id: string, patch: Partial<ShoppingStore>) => void
  deleteStore: (id: string) => void

  // Price watching
  priceWatchLoading: boolean
  refreshPrices:     (itemIds?: string[]) => Promise<void>
  addSnapshots:      (snaps: PriceSnapshot[]) => void

  // Settings
  updateSettings: (patch: Partial<ShoppingSettings>) => void
  setPriceWatchFrequency: (f: ShoppingPriceWatchFrequency) => Promise<void>

  // Realtime cleanup
  _stopRealtime?: () => void
  startRealtime:  (userId: string) => void
  stopRealtime:   () => void
}

// ─── Store creation ───────────────────────────────────────────────────────────

export const useShoppingStore = create<ShoppingState>((set, get) => ({
  groups:    [],
  items:     [],
  stores:    [],
  snapshots: [],
  loading:   false,
  settings:  loadSettings(),
  priceWatchLoading: false,

  enrichedItems: () => {
    const { items, snapshots, stores } = get()
    return enrichItems(items, snapshots, stores)
  },

  // ── Load ──────────────────────────────────────────────────────────────────

  loadAll: async () => {
    set({ loading: true })
    const [groups, items, stores] = await Promise.all([
      db.loadGroups(),
      db.loadItems(),
      db.loadStores(),
    ])
    const validItems = items ?? []
    const snaps = validItems.length
      ? (await db.loadSnapshots(validItems.map(i => i.id))) ?? []
      : []
    set({
      groups:    groups ?? [],
      items:     validItems,
      stores:    stores ?? [],
      snapshots: snaps,
      loading:   false,
    })
  },

  // ── Groups ────────────────────────────────────────────────────────────────

  addGroup: (g) => {
    const now = new Date().toISOString()
    const { groups } = get()
    const newGroup: ShoppingGroup = {
      ...g, id: newId(),
      createdAt: now, updatedAt: now,
    }
    set({ groups: [...groups, newGroup] })
    void db.upsertGroup({ ...newGroup, userId: newGroup.userId })
    return newGroup
  },

  updateGroup: (id, patch) => {
    const now = new Date().toISOString()
    set(s => ({
      groups: s.groups.map(g =>
        g.id === id ? { ...g, ...patch, updatedAt: now } : g
      ),
    }))
    const updated = get().groups.find(g => g.id === id)
    if (updated) void db.upsertGroup({ ...updated, userId: updated.userId })
  },

  deleteGroup: (id) => {
    set(s => ({
      groups: s.groups.filter(g => g.id !== id),
      items:  s.items.map(i => i.groupId === id ? { ...i, groupId: undefined } : i),
    }))
    void db.deleteGroup(id)
  },

  archiveGroup: (id) => {
    get().updateGroup(id, { status: 'archived' })
  },

  // ── Items ─────────────────────────────────────────────────────────────────

  addItem: (item) => {
    const now = new Date().toISOString()
    const newItem: ShoppingItem = {
      ...item, id: newId(),
      createdAt: now, updatedAt: now,
    }
    set(s => ({ items: [...s.items, newItem] }))
    void db.upsertItem({ ...newItem, userId: newItem.userId, name: newItem.name })
    return newItem
  },

  updateItem: (id, patch) => {
    const now = new Date().toISOString()
    set(s => ({
      items: s.items.map(i =>
        i.id === id ? { ...i, ...patch, updatedAt: now } : i
      ),
    }))
    const updated = get().items.find(i => i.id === id)
    if (updated) void db.upsertItem({ ...updated, userId: updated.userId, name: updated.name })
  },

  deleteItem: (id) => {
    set(s => ({
      items:     s.items.filter(i => i.id !== id),
      snapshots: s.snapshots.filter(s => s.itemId !== id),
    }))
    void db.deleteItem(id)
  },

  purchaseItem: (id, finalPrice, storeId) => {
    get().updateItem(id, {
      status:      'purchased',
      purchasedAt: new Date().toISOString(),
      finalPrice,
      storeUsedId: storeId,
    })
  },

  // ── Stores ────────────────────────────────────────────────────────────────

  addStore: (s) => {
    const now = new Date().toISOString()
    const newStore: ShoppingStore = {
      ...s, id: newId(),
      createdAt: now, updatedAt: now,
    }
    set(st => ({ stores: [...st.stores, newStore] }))
    void db.upsertStore({ ...newStore, userId: newStore.userId, name: newStore.name, url: newStore.url })
    return newStore
  },

  updateStore: (id, patch) => {
    const now = new Date().toISOString()
    set(s => ({
      stores: s.stores.map(st =>
        st.id === id ? { ...st, ...patch, updatedAt: now } : st
      ),
    }))
    const updated = get().stores.find(st => st.id === id)
    if (updated) void db.upsertStore({ ...updated, userId: updated.userId, name: updated.name, url: updated.url })
  },

  deleteStore: (id) => {
    set(s => ({ stores: s.stores.filter(st => st.id !== id) }))
    void db.deleteStore(id)
  },

  // ── Price watching ────────────────────────────────────────────────────────

  refreshPrices: async (itemIds?: string[]) => {
    const { items, stores, settings } = get()
    if (!settings.enabled) return

    set({ priceWatchLoading: true })

    const targets = itemIds
      ? items.filter(i => itemIds.includes(i.id) && i.status !== 'purchased')
      : items.filter(i => i.status !== 'purchased')

    if (!targets.length) { set({ priceWatchLoading: false }); return }

    const payload = targets.map(item => ({
      id: item.id,
      name: item.name,
      stores: storesToCheck(item, stores).map(s => ({ id: s.id, url: s.url })),
    })).filter(p => p.stores.length > 0)

    if (!payload.length) { set({ priceWatchLoading: false }); return }

    try {
      const { data, error } = await supabase.functions.invoke('shopping-price-watch', {
        body: { items: payload },
      })
      if (error) { console.warn('[shoppingStore] price watch error:', error.message); return }

      const snaps: PriceSnapshot[] = (data?.results ?? []).map((r: {
        itemId: string; storeId: string; price: number; currency: string
        productUrl?: string; available: boolean
      }) => ({
        id: newId(), itemId: r.itemId, storeId: r.storeId,
        price: r.price, currency: r.currency,
        productUrl: r.productUrl, available: r.available,
        scrapedAt: new Date().toISOString(),
      }))

      if (snaps.length) {
        get().addSnapshots(snaps)
        // Update store scrape status
        const storeIds = [...new Set(snaps.map(s => s.storeId))]
        for (const sid of storeIds) {
          void db.markStoreScraped(sid, true)
        }
        // Update last auto-refreshed timestamp
        get().updateSettings({ lastAutoRefreshed: new Date().toISOString() })
      }
    } finally {
      set({ priceWatchLoading: false })
    }
  },

  addSnapshots: (snaps) => {
    set(s => {
      // Replace snapshots for the same item+store combination, keep the rest
      const keys = new Set(snaps.map(n => `${n.itemId}:${n.storeId}`))
      const kept = s.snapshots.filter(existing => !keys.has(`${existing.itemId}:${existing.storeId}`))
      return { snapshots: [...kept, ...snaps] }
    })
    for (const snap of snaps) {
      void db.insertSnapshot(snap)
    }
  },

  // ── Settings ──────────────────────────────────────────────────────────────

  updateSettings: (patch) => {
    set(s => {
      const next = { ...s.settings, ...patch }
      saveSettings(next)
      return { settings: next }
    })
  },

  setPriceWatchFrequency: async (f) => {
    get().updateSettings({ priceWatchFrequency: f })
    // Tell the edge function to create/update/delete the cron job.
    // The user only sees the frequency label; the cron syntax is handled server-side.
    if (f === 'off') {
      await supabase.functions.invoke('shopping-price-watch', {
        body: { action: 'set_cron', frequency: 'off' },
      }).catch(() => { /* graceful: cron setup is best-effort */ })
    } else {
      await supabase.functions.invoke('shopping-price-watch', {
        body: { action: 'set_cron', frequency: f },
      }).catch(() => { /* graceful */ })
    }
  },

  // ── Realtime ──────────────────────────────────────────────────────────────

  startRealtime: (userId) => {
    const channel = supabase
      .channel(`shopping:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_groups',          filter: `user_id=eq.${userId}` }, () => { void get().loadAll() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items',           filter: `user_id=eq.${userId}` }, () => { void get().loadAll() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_stores',          filter: `user_id=eq.${userId}` }, () => { void get().loadAll() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_price_snapshots'                                  }, () => { void get().loadAll() })
      .subscribe()

    set({ _stopRealtime: () => { void supabase.removeChannel(channel) } })
  },

  stopRealtime: () => {
    const { _stopRealtime } = get()
    _stopRealtime?.()
    set({ _stopRealtime: undefined })
  },
}))

// ─── userId injection helper ──────────────────────────────────────────────────
// The store's addGroup/addItem/addStore stub userId as 'local' because they
// cannot call async supabase.auth.getUser() synchronously.
// The screen components always pass userId explicitly from the auth context.
// These exported setters allow patching it in.

export function setItemUserId(id: string, userId: string) {
  useShoppingStore.getState().updateItem(id, { userId } as Partial<ShoppingItem>)
}
