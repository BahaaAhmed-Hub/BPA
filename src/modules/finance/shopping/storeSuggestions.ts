// Country-aware store suggestions — static data, no network call.
// Keyed by ISO 3166-1 alpha-2 country code. Each entry covers the most-used
// stores for that market across the categories that matter most there.

import type { StoreSuggestion } from './types'

const SUGGESTIONS: Record<string, StoreSuggestion[]> = {
  EG: [
    { name: 'Carrefour Egypt', url: 'https://www.carrefouregypt.com', categories: ['Groceries', 'Home & Kitchen', 'Electronics'], country: 'EG' },
    { name: 'Noon Egypt',      url: 'https://www.noon.com/egypt-en', categories: ['Electronics', 'Clothing', 'Beauty & Care', 'Home & Kitchen'], country: 'EG' },
    { name: 'Amazon Egypt',    url: 'https://www.amazon.eg',         categories: ['Electronics', 'Books & Media', 'Office & School', 'General'], country: 'EG' },
    { name: 'Jumia Egypt',     url: 'https://www.jumia.com.eg',      categories: ['Clothing', 'Electronics', 'Baby & Kids', 'Beauty & Care'], country: 'EG' },
    { name: 'El Ezaby Pharmacy', url: 'https://www.elezabypharmacy.com', categories: ['Pharmacy', 'Beauty & Care'], country: 'EG' },
    { name: 'Ikea Egypt',      url: 'https://www.ikea.com/eg/en',    categories: ['Home & Kitchen'], country: 'EG' },
    { name: 'BM Online',       url: 'https://www.bmonline.com.eg',   categories: ['Groceries', 'General'], country: 'EG' },
  ],
  AE: [
    { name: 'Noon UAE',        url: 'https://www.noon.com/uae-en',   categories: ['Electronics', 'Clothing', 'Beauty & Care', 'Home & Kitchen'], country: 'AE' },
    { name: 'Amazon UAE',      url: 'https://www.amazon.ae',          categories: ['Electronics', 'Books & Media', 'General'], country: 'AE' },
    { name: 'Carrefour UAE',   url: 'https://www.carrefouruae.com',   categories: ['Groceries', 'Home & Kitchen', 'Electronics'], country: 'AE' },
    { name: 'Lulu Hypermarket', url: 'https://www.luluhypermarket.com/en-ae', categories: ['Groceries', 'Home & Kitchen', 'Clothing'], country: 'AE' },
    { name: 'Mumzworld',       url: 'https://www.mumzworld.com',      categories: ['Baby & Kids'], country: 'AE' },
    { name: 'Namshi',          url: 'https://www.namshi.com/uae-en',  categories: ['Clothing', 'Beauty & Care'], country: 'AE' },
  ],
  SA: [
    { name: 'Noon Saudi',      url: 'https://www.noon.com/saudi-en', categories: ['Electronics', 'Clothing', 'Beauty & Care'], country: 'SA' },
    { name: 'Amazon Saudi',    url: 'https://www.amazon.sa',          categories: ['Electronics', 'Books & Media', 'General'], country: 'SA' },
    { name: 'Carrefour Saudi', url: 'https://www.carrefourksa.com',   categories: ['Groceries', 'Home & Kitchen'], country: 'SA' },
    { name: 'Tamimi Markets',  url: 'https://www.tamimimarkets.com',  categories: ['Groceries'], country: 'SA' },
    { name: 'Extra Saudi',     url: 'https://www.extra.com',          categories: ['Electronics', 'Automotive'], country: 'SA' },
  ],
  US: [
    { name: 'Amazon US',       url: 'https://www.amazon.com',         categories: ['Electronics', 'Books & Media', 'General', 'Baby & Kids', 'Sports & Outdoor'], country: 'US' },
    { name: 'Walmart',         url: 'https://www.walmart.com',        categories: ['Groceries', 'Home & Kitchen', 'General', 'Clothing'], country: 'US' },
    { name: 'Target',          url: 'https://www.target.com',         categories: ['Clothing', 'Home & Kitchen', 'Baby & Kids', 'Grocery'], country: 'US' },
    { name: 'Best Buy',        url: 'https://www.bestbuy.com',        categories: ['Electronics'], country: 'US' },
    { name: 'Walgreens',       url: 'https://www.walgreens.com',      categories: ['Pharmacy', 'Beauty & Care'], country: 'US' },
    { name: 'Chewy',           url: 'https://www.chewy.com',          categories: ['Pets'], country: 'US' },
  ],
  GB: [
    { name: 'Amazon UK',       url: 'https://www.amazon.co.uk',       categories: ['Electronics', 'Books & Media', 'General'], country: 'GB' },
    { name: 'Tesco',           url: 'https://www.tesco.com',          categories: ['Groceries', 'Home & Kitchen'], country: 'GB' },
    { name: 'Argos',           url: 'https://www.argos.co.uk',        categories: ['Electronics', 'Home & Kitchen', 'Baby & Kids'], country: 'GB' },
    { name: 'Boots',           url: 'https://www.boots.com',          categories: ['Pharmacy', 'Beauty & Care'], country: 'GB' },
    { name: 'ASOS',            url: 'https://www.asos.com',           categories: ['Clothing'], country: 'GB' },
    { name: 'Pets at Home',    url: 'https://www.petsathome.com',     categories: ['Pets'], country: 'GB' },
  ],
  DE: [
    { name: 'Amazon Germany',  url: 'https://www.amazon.de',          categories: ['Electronics', 'Books & Media', 'General'], country: 'DE' },
    { name: 'Zalando',         url: 'https://www.zalando.de',         categories: ['Clothing'], country: 'DE' },
    { name: 'Rewe',            url: 'https://www.rewe.de',            categories: ['Groceries'], country: 'DE' },
    { name: 'MediaMarkt',      url: 'https://www.mediamarkt.de',      categories: ['Electronics'], country: 'DE' },
    { name: 'dm',              url: 'https://www.dm.de',              categories: ['Pharmacy', 'Beauty & Care'], country: 'DE' },
  ],
}

// Fallback for countries not listed
const GLOBAL_FALLBACK: StoreSuggestion[] = [
  { name: 'Amazon',  url: 'https://www.amazon.com', categories: ['Electronics', 'Books & Media', 'General'], country: '' },
  { name: 'eBay',    url: 'https://www.ebay.com',   categories: ['General', 'Electronics', 'Clothing'],      country: '' },
  { name: 'AliExpress', url: 'https://www.aliexpress.com', categories: ['Electronics', 'Clothing', 'Home & Kitchen', 'General'], country: '' },
]

export function suggestStoresForCountry(countryCode: string): StoreSuggestion[] {
  const code = (countryCode || '').toUpperCase()
  return SUGGESTIONS[code] ?? GLOBAL_FALLBACK
}
