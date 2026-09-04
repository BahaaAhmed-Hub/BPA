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

import * as Lucide from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** The names on offer, in the order they are shown. Grouped so scrolling the
 *  grid moves through one kind of thing at a time rather than an alphabet. */
const GROUPS: [string, string[]][] = [
  ['Money', [
    'Banknote', 'Coins', 'HandCoins', 'PiggyBank', 'Wallet', 'CreditCard', 'Landmark',
    'Receipt', 'ReceiptText', 'CircleDollarSign', 'BadgeDollarSign', 'BadgePercent',
    'TrendingUp', 'TrendingDown', 'BarChart3', 'PieChart', 'LineChart', 'Calculator',
    'Vault', 'Scale', 'ArrowLeftRight', 'HandHeart', 'Gift', 'Percent',
  ]],
  ['Home and bills', [
    'Home', 'House', 'Building', 'Building2', 'DoorOpen', 'Bed', 'Sofa', 'Lamp',
    'Zap', 'Droplet', 'Droplets', 'Flame', 'Plug', 'PlugZap', 'Wifi', 'Router',
    'Thermometer', 'AirVent', 'WashingMachine', 'Refrigerator', 'Microwave',
    'Wrench', 'Hammer', 'PaintRoller', 'Recycle', 'Trash2', 'Umbrella', 'Shield',
    'ShieldCheck', 'Key', 'Lock', 'TreePine', 'Flower2', 'Sprout',
  ]],
  ['Food and drink', [
    'ShoppingCart', 'ShoppingBasket', 'ShoppingBag', 'Store', 'UtensilsCrossed',
    'Utensils', 'ChefHat', 'Pizza', 'Sandwich', 'Soup', 'Salad', 'Beef', 'Fish',
    'Egg', 'Croissant', 'Cookie', 'Candy', 'IceCreamCone', 'Cake', 'CakeSlice',
    'Apple', 'Cherry', 'Grape', 'Banana', 'Carrot', 'Wheat', 'Milk', 'Coffee',
    'CupSoda', 'Wine', 'Beer', 'Martini',
  ]],
  ['Getting about', [
    'CarFront', 'Car', 'CarTaxiFront', 'Truck', 'Bus', 'TramFront', 'TrainFront',
    'Train', 'Bike', 'Footprints', 'Fuel', 'ParkingCircle', 'Plane', 'PlaneTakeoff',
    'Ship', 'Sailboat', 'Map', 'MapPin', 'Navigation', 'Luggage', 'Package',
    'PackageCheck', 'Send', 'Compass',
  ]],
  ['People', [
    'User', 'Users', 'UserPlus', 'Baby', 'PersonStanding', 'Heart', 'HeartHandshake',
    'Handshake', 'Smile', 'PawPrint', 'Dog', 'Cat', 'Bird', 'Rabbit', 'Backpack',
    'School', 'Home as Family', 'Cake as Birthday', 'PartyPopper', 'Church',
  ]],
  ['Health and self', [
    'Stethoscope', 'Hospital', 'Pill', 'Syringe', 'Cross', 'HeartPulse', 'Activity',
    'Brain', 'Eye', 'Ear', 'Bone', 'Dumbbell', 'Bike as Cycling', 'Scissors',
    'Shirt', 'Glasses', 'Watch', 'Gem', 'Sparkles', 'Bath', 'ShowerHead',
  ]],
  ['Learning and work', [
    'GraduationCap', 'Book', 'BookOpen', 'Library', 'NotebookPen', 'PenTool',
    'Briefcase', 'BriefcaseBusiness', 'Laptop', 'Monitor', 'Printer', 'Presentation',
    'ClipboardList', 'FileText', 'Folder', 'FolderOpen', 'Paperclip', 'Mail',
    'Phone', 'Palette', 'Camera', 'Mic', 'Ruler', 'Lightbulb',
  ]],
  ['Leisure', [
    'Tv', 'MonitorPlay', 'Clapperboard', 'Popcorn', 'Film', 'Music', 'Music4',
    'Headphones', 'Radio', 'Gamepad2', 'Dices', 'Puzzle', 'Ticket', 'Trophy',
    'Medal', 'Target', 'Tent', 'Mountain', 'Waves', 'Sun', 'Palmtree', 'Guitar',
  ]],
  ['Devices and services', [
    'Smartphone', 'MonitorSmartphone', 'Tablet', 'Cloud', 'CloudDownload', 'Server',
    'Database', 'Repeat', 'RefreshCw', 'Bell', 'Calendar', 'Clock', 'Timer',
    'Globe', 'Link', 'QrCode', 'Bot', 'Cpu', 'HardDrive', 'Battery',
  ]],
  ['Anything else', [
    'Star', 'Bookmark', 'Tag', 'Tags', 'Flag', 'Pin', 'Box', 'Boxes', 'Archive',
    'Layers', 'Grid3x3', 'Shapes', 'Circle', 'Square', 'Triangle', 'Hexagon',
    'Plus', 'Minus', 'Check', 'X', 'Info', 'CircleHelp', 'TriangleAlert', 'Ban',
  ]],
]

/** Lucide renames and retires things between releases, so a name that is not
 *  in the build is dropped rather than crashing the picker. An alias written
 *  "Real as Shown" keeps a second entry pointing at the same drawing. */
/** Lucide icons are forwardRef objects, not functions — checking for a
 *  function rejects every one of them and leaves an empty picker. */
function isComponent(v: unknown): v is LucideIcon {
  if (typeof v === 'function') return true
  return typeof v === 'object' && v !== null && '$$typeof' in (v as object)
}

function resolve(): { icons: Record<string, LucideIcon>; order: string[]; sections: [string, string[]][] } {
  const icons: Record<string, LucideIcon> = {}
  const order: string[] = []
  const sections: [string, string[]][] = []
  const all = Lucide as unknown as Record<string, unknown>

  for (const [title, names] of GROUPS) {
    const kept: string[] = []
    for (const entry of names) {
      const [real, alias] = entry.split(' as ')
      const key = alias ?? real
      const icon = all[real]
      if (!isComponent(icon) || icons[key]) continue
      icons[key] = icon
      kept.push(key)
      order.push(key)
    }
    if (kept.length) sections.push([title, kept])
  }
  return { icons, order, sections }
}

const RESOLVED = resolve()

export const LUCIDE_ICONS = RESOLVED.icons
export const LUCIDE_ORDER = RESOLVED.order
/** The same icons, still grouped, for a picker that wants headings. */
export const LUCIDE_SECTIONS = RESOLVED.sections

export const LUCIDE_PREFIX = 'lucide:'

export function isLucideIcon(icon: string | undefined): boolean {
  return !!icon?.startsWith(LUCIDE_PREFIX)
}

export function lucideComponent(icon: string | undefined): LucideIcon | null {
  if (!isLucideIcon(icon)) return null
  return LUCIDE_ICONS[icon!.slice(LUCIDE_PREFIX.length)] ?? null
}

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

/** "car" should reach CarFront and CarTaxiFront; "food" should reach the
 *  things you eat even though none of them is called that. */
const SEARCH_WORDS: Record<string, string> = {
  UtensilsCrossed: 'food eat restaurant dining', Utensils: 'food eat',
  ShoppingCart: 'grocery groceries supermarket', ShoppingBasket: 'grocery shop',
  Banknote: 'money cash salary note', Coins: 'money change cash',
  CircleDollarSign: 'money dollar', PiggyBank: 'savings save',
  CreditCard: 'card debt credit', Landmark: 'bank', Receipt: 'bill invoice tax',
  Zap: 'electricity power energy', Droplet: 'water', Flame: 'gas heating fire',
  Plug: 'utilities bill', Wifi: 'internet broadband', Router: 'internet',
  CarFront: 'car vehicle auto', CarTaxiFront: 'taxi cab uber',
  Fuel: 'petrol gas diesel', Bus: 'transport commute',
  TrainFront: 'train rail metro', Plane: 'travel flight holiday',
  Stethoscope: 'doctor health medical', Pill: 'pharmacy medicine drug',
  Dumbbell: 'gym fitness sport', GraduationCap: 'school education tuition',
  Backpack: 'school kids child', Baby: 'child kids nursery',
  PawPrint: 'pet animal vet', HandHeart: 'charity donation giving',
  Tv: 'streaming netflix television', Clapperboard: 'cinema movie film',
  Gamepad2: 'games gaming console', MonitorSmartphone: 'apps digital subscription',
  Smartphone: 'phone mobile', Briefcase: 'work business job',
  Building2: 'office company work', Shirt: 'clothes clothing fashion',
  Scissors: 'haircut barber salon', Gem: 'jewellery jewelry luxury',
  Shield: 'insurance protection', Wrench: 'repair maintenance fix',
  Repeat: 'recurring monthly subscription', Package: 'other misc delivery parcel',
  Gift: 'present birthday', Heart: 'love partner wife husband',
  Sparkles: 'personal self beauty', Home: 'rent mortgage house housing',
}

/** Line icons whose name or meaning matches what has been typed. */
export function searchLucide(query: string, limit = 64): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const spaced = (n: string) => n.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase()
  const starts: string[] = []
  const rest: string[] = []
  for (const name of LUCIDE_ORDER) {
    const hay = `${spaced(name)} ${SEARCH_WORDS[name] ?? ''}`
    if (!hay.includes(q)) continue
    if (spaced(name).startsWith(q)) starts.push(name)
    else rest.push(name)
  }
  return [...starts, ...rest].slice(0, limit)
}
