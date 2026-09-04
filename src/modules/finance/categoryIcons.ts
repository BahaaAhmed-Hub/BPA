// ─── Line icons for categories ───────────────────────────────────────────────
// Categories carried emoji, which are somebody else's illustrations: they
// arrive coloured, they look different on every device, and a row of them
// reads as a row of pictures rather than a set of labels. Lucide is already
// what the rest of the app draws with, so a category can hold one of those
// instead — one weight, one colour, the colour being whatever the envelope is.
//
// The icon field stays a plain string. "lucide:CarFront" is a line icon,
// anything starting data:/http: is an uploaded picture, and everything else is
// still an emoji, so nothing already chosen stops working.

import {
  Apple, Baby, Backpack, Banknote, BarChart3, Beef, Beer, Bike, Book, Briefcase,
  Building2, Bus, Cake, Candy, Car, CarFront, Carrot, Church, Clapperboard,
  Coffee, Coins, CreditCard, Croissant, Milk,
  Cross, Dog, Dumbbell, Fuel, Gamepad2, Gem, Gift, GraduationCap, HandCoins,
  HandHeart, Heart, Home, Hospital, Landmark, Laptop, Leaf, Lightbulb,
  MonitorSmartphone, Music, PawPrint, PiggyBank, Pill, Plane, Plug, Popcorn,
  Receipt, Recycle, Repeat, Scissors, Shield, ShoppingBag, ShoppingCart, Shirt,
  Smartphone, Sofa, Sparkles, Stethoscope, Ticket, Train, Trophy, Tv, Umbrella,
  UtensilsCrossed, Wallet, Wifi, Wrench, Zap, Droplet, Flame, Package, Palette,
  Plane as Flight, Store, Users, Wine, CircleDollarSign, Folder,
  type LucideIcon,
} from 'lucide-react'

export const LUCIDE_ICONS: Record<string, LucideIcon> = {
  Apple, Baby, Backpack, Banknote, BarChart3, Beef, Beer, Bike, Book, Briefcase,
  Building2, Bus, Cake, Candy, Car, CarFront, Carrot, Church, Clapperboard,
  Coffee, Coins, CreditCard, Croissant, Milk,
  Cross, Dog, Dumbbell, Fuel, Gamepad2, Gem, Gift, GraduationCap, HandCoins,
  HandHeart, Heart, Home, Hospital, Landmark, Laptop, Leaf, Lightbulb,
  MonitorSmartphone, Music, PawPrint, PiggyBank, Pill, Plane, Plug, Popcorn,
  Receipt, Recycle, Repeat, Scissors, Shield, ShoppingBag, ShoppingCart, Shirt,
  Smartphone, Sofa, Sparkles, Stethoscope, Ticket, Train, Trophy, Tv, Umbrella,
  UtensilsCrossed, Wallet, Wifi, Wrench, Zap, Droplet, Flame, Package, Palette,
  Flight, Store, Users, Wine, CircleDollarSign, Folder,
}

export const LUCIDE_PREFIX = 'lucide:'

export function isLucideIcon(icon: string | undefined): boolean {
  return !!icon?.startsWith(LUCIDE_PREFIX)
}

export function lucideComponent(icon: string | undefined): LucideIcon | null {
  if (!isLucideIcon(icon)) return null
  return LUCIDE_ICONS[icon!.slice(LUCIDE_PREFIX.length)] ?? null
}

/** The order they are offered in — grouped so the common ones come first. */
export const LUCIDE_ORDER: string[] = [
  // Everyday spending
  'ShoppingCart', 'ShoppingBag', 'Store', 'UtensilsCrossed', 'Coffee', 'Wine', 'Beer', 'Cake',
  'Apple', 'Carrot', 'Beef', 'Milk', 'Croissant', 'Candy',
  // Home and bills
  'Home', 'Sofa', 'Zap', 'Droplet', 'Flame', 'Plug', 'Wifi', 'Umbrella', 'Wrench', 'Recycle',
  // Getting about
  'CarFront', 'Car', 'Fuel', 'Bus', 'Train', 'Bike', 'Plane', 'Package',
  // People
  'Users', 'Baby', 'Heart', 'HandHeart', 'PawPrint', 'Dog', 'Gift',
  // Health and self
  'Stethoscope', 'Hospital', 'Pill', 'Cross', 'Dumbbell', 'Scissors', 'Shirt', 'Gem', 'Sparkles',
  // Learning and work
  'GraduationCap', 'Book', 'Backpack', 'Briefcase', 'Building2', 'Laptop', 'BarChart3', 'Palette',
  // Leisure
  'Tv', 'Clapperboard', 'Popcorn', 'Music', 'Gamepad2', 'Ticket', 'Trophy', 'Church', 'Leaf',
  // Devices and services
  'Smartphone', 'MonitorSmartphone', 'Lightbulb', 'Shield', 'Repeat',
  // Money itself
  'Banknote', 'Coins', 'HandCoins', 'PiggyBank', 'Wallet', 'CreditCard', 'Landmark',
  'Receipt', 'CircleDollarSign', 'Folder',
]

// ─── Guessing a sensible one from the name ───────────────────────────────────
// Longest match wins, so "car insurance" reaches Shield rather than CarFront,
// and "phone bill" reaches Smartphone rather than Receipt.

const RULES: [string[], string][] = [
  [['salary', 'payroll', 'wage', 'income', 'paycheck'], 'Banknote'],
  [['bonus', 'commission'], 'HandCoins'],
  [['freelance', 'consult', 'contract', 'business', 'client', 'invoice'], 'Briefcase'],
  [['dividend', 'interest', 'investment', 'stocks', 'shares', 'portfolio'], 'BarChart3'],
  [['saving', 'savings', 'emergency fund', 'nest egg'], 'PiggyBank'],
  [['rent', 'mortgage', 'housing', 'home', 'house', 'flat', 'apartment'], 'Home'],
  [['furniture', 'furnishing', 'decor'], 'Sofa'],
  [['electric', 'electricity', 'power'], 'Zap'],
  [['water'], 'Droplet'],
  [['gas ', 'gas', 'heating'], 'Flame'],
  [['utility', 'utilities', 'bill', 'bills'], 'Plug'],
  [['internet', 'wifi', 'broadband', 'router'], 'Wifi'],
  [['phone', 'mobile', 'cell'], 'Smartphone'],
  [['app', 'apps', 'software', 'subscription', 'saas', 'digital'], 'MonitorSmartphone'],
  [['stream', 'streaming', 'netflix', 'spotify', 'tv'], 'Tv'],
  [['cinema', 'movie', 'film'], 'Clapperboard'],
  [['music', 'concert'], 'Music'],
  [['game', 'gaming', 'games'], 'Gamepad2'],
  [['grocer', 'groceries', 'supermarket', 'market', 'food shop'], 'ShoppingCart'],
  [['fruit', 'produce'], 'Apple'],
  [['vegetable', 'veg', 'greens', 'salad'], 'Carrot'],
  [['meat', 'butcher', 'poultry', 'chicken'], 'Beef'],
  [['dairy', 'milk', 'cheese'], 'Milk'],
  [['bakery', 'bread', 'pastry'], 'Croissant'],
  [['sweets', 'candy', 'chocolate', 'snack', 'snacks'], 'Candy'],
  [['restaurant', 'dining', 'eat', 'eating', 'food', 'lunch', 'dinner', 'takeaway'], 'UtensilsCrossed'],
  [['coffee', 'cafe', 'café'], 'Coffee'],
  [['shopping', 'clothes', 'clothing', 'fashion', 'wardrobe'], 'Shirt'],
  [['beauty', 'salon', 'haircut', 'barber', 'cosmetic'], 'Scissors'],
  [['jewel', 'jewellery', 'jewelry', 'watch'], 'Gem'],
  [['car', 'vehicle', 'auto', 'motor'], 'CarFront'],
  [['fuel', 'petrol', 'gasoline', 'diesel', 'benzine'], 'Fuel'],
  [['transport', 'commute', 'taxi', 'uber', 'bus', 'metro'], 'Bus'],
  [['train', 'rail'], 'Train'],
  [['travel', 'flight', 'holiday', 'vacation', 'trip'], 'Plane'],
  [['delivery', 'shipping', 'courier', 'parcel'], 'Package'],
  [['insurance'], 'Shield'],
  [['debt', 'loan', 'credit card', 'instal', 'repayment'], 'CreditCard'],
  [['tax', 'zakat', 'vat', 'fees', 'fee', 'charges'], 'Receipt'],
  [['bank', 'account'], 'Landmark'],
  [['school', 'tuition', 'education', 'university', 'college', 'course'], 'GraduationCap'],
  [['book', 'books', 'reading'], 'Book'],
  [['kid', 'kids', 'child', 'children', 'baby', 'nursery'], 'Baby'],
  [['girl', 'girls', 'daughter', 'son', 'boys'], 'Backpack'],
  [['family', 'people', 'team', 'staff'], 'Users'],
  [['wife', 'husband', 'partner', 'anniversary', 'love'], 'Heart'],
  [['gift', 'present', 'birthday'], 'Gift'],
  [['charity', 'donation', 'sadaqa', 'giving'], 'HandHeart'],
  [['pet', 'dog', 'cat', 'vet'], 'PawPrint'],
  [['doctor', 'medical', 'health', 'clinic', 'dentist'], 'Stethoscope'],
  [['hospital'], 'Hospital'],
  [['pharmacy', 'medicine', 'drug', 'prescription'], 'Pill'],
  [['gym', 'fitness', 'sport', 'training', 'workout'], 'Dumbbell'],
  [['personal', 'self', 'me', 'my own'], 'Sparkles'],
  [['laptop', 'computer', 'hardware', 'device', 'tech'], 'Laptop'],
  [['office', 'work'], 'Building2'],
  [['maintenance', 'repair', 'fix', 'service'], 'Wrench'],
  [['cleaning', 'waste', 'rubbish', 'garbage'], 'Recycle'],
  [['ticket', 'event', 'entertain'], 'Ticket'],
  [['sport', 'club', 'membership'], 'Trophy'],
  [['garden', 'plant', 'nature'], 'Leaf'],
  [['mosque', 'church', 'religion'], 'Church'],
  [['misc', 'other', 'others', 'sundry', 'general'], 'Package'],
  [['monthly', 'recurring', 'standing'], 'Repeat'],
  [['cash', 'wallet', 'pocket'], 'Wallet'],
]

/** A line icon that suits the name, or null when nothing in the table fits —
 *  in which case leaving what is already there beats guessing. */
export function suggestIcon(name: string): string | null {
  const n = ` ${name.toLowerCase().trim()} `
  let best: { icon: string; len: number } | null = null
  for (const [words, icon] of RULES) {
    for (const w of words) {
      if (!n.includes(w)) continue
      if (!best || w.length > best.len) best = { icon, len: w.length }
    }
  }
  return best ? LUCIDE_PREFIX + best.icon : null
}

/** Icons nobody chose — a category still wearing a default has nothing to lose
 *  by being given something that means anything at all. */
const PLACEHOLDERS = new Set(['📁', '📂', '🗂', '🗂️', '', 'lucide:Folder'])

export function isPlaceholderIcon(icon: string | undefined): boolean {
  return !icon || PLACEHOLDERS.has(icon)
}
