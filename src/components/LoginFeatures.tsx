// ─── What the app is, under the sign-in card ─────────────────────────────────
//
// The five cards and the spans are the reference's; the words are not. The
// original reads "Save your files — we automatically save your files as you
// type", which is the Magic UI demo describing a file manager. On the first
// screen of *this* product that is a promise about somebody else's app, so each
// card says a thing The Professor actually does — and only things it does: no
// card here claims a capability the modules do not have.

import {
  CalendarDays, FileText, Inbox, Target, Wallet,
} from 'lucide-react'
import { BentoCard, BentoGrid, type BentoCardProps } from '@/components/ui/bento-grid'

/** A soft wash in the card's own hue. Decoration — it carries nothing, and it
 *  is drawn from a token so it follows the theme rather than fighting it. */
function Wash({ token }: { token: string }) {
  return (
    <div
      className="absolute -top-16 -right-16 h-48 w-48 rounded-full opacity-70 blur-2xl"
      style={{ background: `color-mix(in srgb, var(${token}) 42%, transparent)` }}
    />
  )
}

const features: BentoCardProps[] = [
  {
    Icon: FileText,
    name: 'The morning brief',
    description:
      'Reads the night’s mail, the day’s calendar and yesterday’s tasks, then says what today is for — in sentences, with the numbers behind them.',
    background: <Wash token="--sb-accent" />,
    className: 'lg:col-start-2 lg:col-end-3 lg:row-start-1 lg:row-end-4',
  },
  {
    Icon: Inbox,
    name: 'Mail that sorts itself',
    description:
      'Every message filed by what it wants — an answer, a booking, a decision — with the reply already drafted. Nothing is ever sent for you.',
    background: <Wash token="--sb-info" />,
    className: 'lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-3',
  },
  {
    Icon: Target,
    name: 'Habits that count properly',
    // One row high, so one line long: a small cell in a bento carries a
    // sentence, not a paragraph.
    description: 'One tap adds 250 ml, not 1 ml.',
    background: <Wash token="--sb-positive" />,
    className: 'lg:col-start-1 lg:col-end-2 lg:row-start-3 lg:row-end-4',
  },
  {
    Icon: CalendarDays,
    name: 'A calendar you draw on',
    description: 'Draw a span to make an event.',
    background: <Wash token="--sb-accent" />,
    className: 'lg:col-start-3 lg:col-end-4 lg:row-start-1 lg:row-end-2',
  },
  {
    Icon: Wallet,
    name: 'Money, in its own currency',
    description:
      '250 USD stays 250 USD until something has to add it up. Budgets write the entry, unpaid stays out of every total, and the ledger is behind its own lock.',
    background: <Wash token="--sb-positive" />,
    className: 'lg:col-start-3 lg:col-end-4 lg:row-start-2 lg:row-end-4',
  },
]

export function LoginFeatures() {
  return (
    // An explicit row count makes the rows fractions of the grid's own height,
    // and the grid has none unless it is given one — so the tall cards stretched
    // to whatever the column beside them came to and stood half empty.
    <BentoGrid className="lg:h-[30rem] lg:grid-rows-3">
      {features.map(f => <BentoCard key={f.name} {...f} />)}
    </BentoGrid>
  )
}
