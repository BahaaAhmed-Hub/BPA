// ─── What the app is, for the assistant to answer from ───────────────────────
//
//  The assistant used to know only what its prompt said, so "how do I…" about a
//  module was a guess. This is the thing to answer from: one entry per place in
//  the app, in plain words, with where to find each thing. It is deliberately
//  conservative — a feature is listed only where the screen has it — and the
//  assistant is told that anything not here is not known, rather than invented.
//
//  Keep it short and keep it true: when a screen changes, change its entry.

export interface GuideEntry {
  title: string
  /** Where it is, in the words the screen uses. */
  where: string
  /** What it is for, in a sentence. */
  summary: string
  /** What you can do there. */
  can: string[]
  /** What the assistant can do for the person here, through its tools. */
  assistant: string[]
}

export const APP_GUIDE: Record<string, GuideEntry> = {
  overview: {
    title: 'The app at a glance',
    where: 'The round buttons down the left edge; the avatar at the top right; the assistant button at the bottom right',
    summary: 'Modules in the left rail: Today, Calendar, Mail, Tasks, Habits, Finance, Library and Dashboard (Library can be switched off, by plan or in Settings). Settings is in the menu under the avatar. The search box at the top opens the command palette. The circles under the modules are your companies: press one and everything that is not that company\'s goes quiet on every screen, press it again to clear.',
    can: ['Move between modules with the left rail', 'Search from the box at the top', 'Open Settings from the avatar menu', 'Filter by company with the company circles'],
    assistant: ['Answer questions about any module', 'Read and change your own tasks, calendar, mail, habits, finances, shopping and books', 'Ask for your OK before anything that other people see, cannot be undone, or moves money'],
  },
  today: {
    title: 'Today',
    where: 'Left rail → Today',
    summary: 'The morning page: a brief for the day, today\'s events, the mail that needs you, and a quote of the day from your Library.',
    can: ['Read the day\'s brief', 'See today\'s events', 'Work through the mail card: archive, reply (a draft opens, nothing is sent until you press Send), answer an invitation with Yes / Maybe / No', 'Archive newsletters in one go'],
    assistant: ['Say what needs you (the same list Mail shows)', 'Archive mail and answer invitations when you ask, after your OK for the answer'],
  },
  calendar: {
    title: 'Calendar',
    where: 'Left rail → Calendar',
    summary: 'Your Google calendars as a week grid. The panel on the right is where an event is made and edited; changes are written to Google as you make them.',
    can: ['Create, edit, drag and delete events', 'Show or hide each calendar', 'Open hours: let someone outside book a slot you open on the week (booking)', 'After a meeting, record what came out of it'],
    assistant: ['List events for any range', 'Create events, edit and move them, delete them (after your OK)'],
  },
  mail: {
    title: 'Mail',
    where: 'Left rail → Mail',
    summary: 'The smart view of the last 30 days, across every connected mailbox, grouped by what each thread wants of you: Requires your action, Worth knowing, On your radar, and FYI. Views along the top narrow it further.',
    can: ['Archive (this really archives the thread in Gmail)', 'Answer an invitation with Yes / Maybe / No (this sets your real reply on the calendar event and tells the organiser)', 'Draft a reply — nothing is sent until you press Send', 'Mark done, acknowledge a notice, ignore a thread', 'Make a task from a thread'],
    assistant: ['List what needs you, search mail, read a thread', 'Archive, mark read, send or reply (after your OK), answer an invitation (after your OK)'],
  },
  tasks: {
    title: 'Tasks',
    where: 'Left rail → Tasks',
    summary: 'A task board with three ways of looking at it (Board, Matrix, List), a detail panel for each task, and a planner that lays your day out. A date decides the quadrant; undo with the undo key (⌘Z / Ctrl+Z).',
    can: ['Add, edit, complete and delete tasks', 'Switch between Board, Matrix and List', 'Plan my day', 'Undo the last change'],
    assistant: ['List, create, update and complete tasks', 'Delete a task (after your OK)'],
  },
  habits: {
    title: 'Habits',
    where: 'Left rail → Habits',
    summary: 'A table of your habits with a record of the last months; any day in the record can be edited. A habit can carry a picture. Apple Health can feed some habits where the platform allows it.',
    can: ['Log today, or any past day from its square in the record', 'Create, edit and delete habits', 'Settings → Habits configures them'],
    assistant: ['List habits and log completions'],
  },
  finance: {
    title: 'Finance',
    where: 'Left rail → Finance (it may ask you to unlock it first)',
    summary: 'The ledger and what it says: Today, Balance, Budget, Reports, Financials and Goals, and Shopping when it is on. Every figure is shown in your base currency; an entry keeps its own currency. An entry with no payment date is owed, not paid. A credit card is borrowed money, never cash; reward points are never money.',
    can: ['Add, edit and delete entries (Bulk entry and a duplicate review exist too)', 'Budget envelopes and their spend', 'Goals with a plan for reaching them', 'Settings → Finance sets envelope style, figures, dates and alerts'],
    assistant: ['Answer money questions from the ledger (balances, spending by category, budgets, goals, price history)', 'Record, change and delete entries, change goals, rates and envelopes — each only after your OK'],
  },
  shopping: {
    title: 'Shopping',
    where: 'Finance → Shopping (when it is switched on)',
    summary: 'Shopping lists grouped by store, with each item checked at the stores you choose and a price history.',
    can: ['Add and edit items where they are', 'Mark items purchased', 'See price history'],
    assistant: ['List items and groups, add an item, mark purchased, show price history'],
  },
  library: {
    title: 'Library',
    where: 'Left rail → Library (Settings → Library turns it on or off)',
    summary: 'Your books. Views along the top: Shelf (spines on a bookcase), Covers (covers face out), Lists (your categories and lists), Quotes, Discover and Tracker. Add book, New list and Scan shelf open a panel on the right.',
    can: ['Add a book by searching (the cover and details are found for you), or by hand', 'Scan shelf: photograph a shelf — up to five photos at once — and add the books it reads; needs the AI key in Settings → AI', 'Sort books into categories (what a book is) and lists (what you are doing with it)', 'Keep quotes and notes, with a page; save a quote from a photo; export them', 'Discover books, follow an author, find where to read or buy a book', 'Log reading sessions, make a reading plan with a finish date, set a yearly goal; the Tracker shows the week and the streak'],
    assistant: ['Say what is on your shelf and what you are reading', 'Add books, change status or rating, shelve them, save quotes (see the library tools)'],
  },
  assistant: {
    title: 'The assistant',
    where: 'The button at the bottom right',
    summary: 'It works for the signed-in person, on their own data only. It asks for your OK, with the real details shown, before anything that other people see (mail, replies, answers to invitations), anything that cannot be undone (a delete) or anything that changes money. You can attach images, PDFs and text files, and talk to it with the microphone. Its name, model and key are in Settings → AI.',
    can: ['Ask in your own words', 'Approve or decline what it proposes', 'Collapse it by clicking elsewhere; ✕ closes and forgets the conversation'],
    assistant: [],
  },
  settings: {
    title: 'Settings',
    where: 'Avatar menu → Settings',
    summary: 'Sections: Profile, Billing, Accounts & companies, AI, Schedule rules, Integrations, Tasks, Habits, Library, Automation, Notifications, Appearance, Behavioral OS, Data & privacy, Finance.',
    can: ['Connect Google accounts and set up companies (Accounts & companies)', 'Set the AI key, model and the assistant\'s name (AI)', 'Pick the theme and accent (Appearance)', 'Switch the Library on or off (Library)', 'Set rules that run without asking (Automation)'],
    assistant: ['Explain any setting and where it is'],
  },
  search: {
    title: 'Search and the command palette',
    where: 'The search box at the top right',
    summary: 'Searches across the app. Typing the assistant\'s name followed by a comma (for example "Beau, what is on today?") asks the assistant directly.',
    can: ['Search the app', 'Ask the assistant from the box'],
    assistant: [],
  },
}

/** The topic whose id or title best matches what was asked for, or null. */
export function findGuide(topic: string): { id: string; entry: GuideEntry } | null {
  const t = topic.trim().toLowerCase()
  if (!t) return null
  if (APP_GUIDE[t]) return { id: t, entry: APP_GUIDE[t] }
  const hit = Object.entries(APP_GUIDE).find(([id, e]) => id.includes(t) || t.includes(id) || e.title.toLowerCase().includes(t))
  return hit ? { id: hit[0], entry: hit[1] } : null
}
