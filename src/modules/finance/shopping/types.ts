// Shopping List — type definitions
// These are the client-side shapes. DB column names are snake_case; this layer
// uses camelCase throughout to match the rest of the codebase.

export type ShoppingStatus    = 'wanted' | 'planned' | 'purchased'
export type ShoppingGroupStatus = 'active' | 'archived' | 'suspended'
export type ShoppingRecurrence = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom'
export type ShoppingViewMode  = 'byWeek' | 'byMonth'

export interface ShoppingGroup {
  id:             string
  userId:         string
  name:           string
  color:          string
  icon:           string
  scheduledDate?: string     // ISO date 'YYYY-MM-DD'
  recurrence:     ShoppingRecurrence
  recurrenceRule?: string   // RRULE for 'custom'
  nextRunAt?:     string    // ISO timestamp
  status:         ShoppingGroupStatus
  sortOrder:      number
  createdAt:      string
  updatedAt:      string
}

export interface ShoppingItem {
  id:               string
  userId:           string
  groupId?:         string
  name:             string
  category:         string
  quantity:         number
  unit?:            string
  priority:         number
  status:           ShoppingStatus
  targetPriceMax?:  number
  currency:         string
  budgetEnvelopeId?: string   // budget rule id
  calendarEventId?: string
  taskId?:          string
  notes?:           string
  purchasedAt?:     string
  finalPrice?:      number
  storeUsedId?:     string
  sortOrder:        number
  createdAt:        string
  updatedAt:        string
  // Populated client-side from snapshots
  bestPrice?:       PriceSummary
  priceHistory?:    PriceSnapshot[]
  suggestedStores?: string[]   // store ids whose categories match item.category
}

export interface ShoppingStore {
  id:            string
  userId:        string
  name:          string
  url:           string
  country?:      string
  categories:    string[]
  lastScrapedAt?: string
  lastScrapeOk?:  boolean
  sortOrder:     number
  createdAt:     string
  updatedAt:     string
}

export interface PriceSnapshot {
  id:         string
  itemId:     string
  storeId:    string
  price:      number
  currency:   string
  productUrl?: string
  available:  boolean
  scrapedAt:  string
}

export interface PriceSummary {
  price:      number
  currency:   string
  storeId:    string
  storeName:  string
  productUrl?: string
  scrapedAt:  string
}

// ─── Country-aware store suggestion shape ─────────────────────────────────────

export interface StoreSuggestion {
  name:       string
  url:        string
  categories: string[]
  country:    string
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export type ShoppingPriceWatchFrequency = 'off' | '6h' | '12h' | '24h' | '7d'

export interface ShoppingSettings {
  enabled:               boolean
  viewMode:              ShoppingViewMode
  priceWatchFrequency:   ShoppingPriceWatchFrequency
  markCalendarDoneOnPurchase: boolean
  markTaskDoneOnPurchase:     boolean
  lastAutoRefreshed?:    string
}

export const DEFAULT_SHOPPING_SETTINGS: ShoppingSettings = {
  enabled:                    false,
  viewMode:                   'byWeek',
  priceWatchFrequency:        'off',
  markCalendarDoneOnPurchase: false,
  markTaskDoneOnPurchase:     false,
}

// ─── Item categories (shared across stores and items) ─────────────────────────

export const ITEM_CATEGORIES = [
  'Groceries',
  'Pharmacy',
  'Electronics',
  'Clothing',
  'Home & Kitchen',
  'Beauty & Care',
  'Baby & Kids',
  'Sports & Outdoor',
  'Books & Media',
  'Office & School',
  'Automotive',
  'Pets',
  'General',
] as const

export type ItemCategory = typeof ITEM_CATEGORIES[number]
