// ─── Bento grid ──────────────────────────────────────────────────────────────
//
// Magic UI's bento-grid, which the app did not have: the reference imports it
// from `@/registry/magicui/bento-grid`, and that registry is not installed.
// This is the same component and the same props — `name`, `description`,
// `Icon`, `background`, `className`, and an optional `href`/`cta` — so a card
// written against the original drops straight in.
//
// Two deliberate departures from the copy-paste version:
//
// - **The colours are the app's tokens, not Tailwind's palette.** `bg-white`
//   and `text-neutral-700` are one theme's answer, and this app has four; a
//   card that ignores them is a white rectangle in Glass & Depth. Tailwind v4
//   takes arbitrary values, so the classes carry `--sb-*` and the grid follows
//   the theme like everything else.
// - **The call to action only exists where there is somewhere to go.** The
//   reference gives every card `href: "/"` and a "Learn more" that lands back
//   on the same page. A control that looks live and does nothing is the thing
//   `components/ComingSoon.tsx` exists to prevent, so the footer renders only
//   when a real `href` is passed.

import type { ComponentType, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'

function cn(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(' ')
}

export interface BentoCardProps {
  name: string
  description: string
  /** Any icon component taking a `className` — lucide's all do. */
  Icon: ComponentType<{ className?: string }>
  /** Painted behind the card, under the text. Decoration, so it is inert. */
  background?: ReactNode
  /** Where the grid puts this one. The reference's `lg:col-start-…` spans. */
  className?: string
  href?: string
  cta?: string
}

export function BentoGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid w-full grid-cols-1 gap-4 lg:auto-rows-[13rem] lg:grid-cols-3', className)}>
      {children}
    </div>
  )
}

export function BentoCard({
  name, description, Icon, background, className, href, cta,
}: BentoCardProps) {
  return (
    <div
      className={cn(
        'group relative flex flex-col justify-between overflow-hidden rounded-[var(--sb-r-card)]',
        'border border-[var(--sb-border)] bg-[var(--sb-card)]',
        'shadow-[var(--sb-shadow-control)] transition-shadow duration-300 hover:shadow-[var(--sb-shadow-hover)]',
        className,
      )}
    >
      {background && <div aria-hidden className="pointer-events-none absolute inset-0">{background}</div>}

      <div className={cn(
        'pointer-events-none z-10 flex transform-gpu flex-col gap-1 p-5',
        'transition-transform duration-300', href && 'group-hover:-translate-y-8',
      )}>
        <Icon className="mb-1 h-9 w-9 origin-left transform-gpu text-[var(--sb-ink-1)] transition-transform duration-300 ease-in-out group-hover:scale-90" />
        <h3 className="font-[var(--sb-font-num)] text-[17px] font-semibold tracking-[-0.02em] text-[var(--sb-ink-1)]">
          {name}
        </h3>
        <p className="max-w-lg text-[13.5px] leading-[1.6] text-[var(--sb-ink-3)]">{description}</p>
      </div>

      {href && cta && (
        <div className="pointer-events-none absolute bottom-0 flex w-full translate-y-8 transform-gpu flex-row items-center p-4 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <a
            href={href}
            className="pointer-events-auto inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--sb-ink-1)]"
          >
            {cta}<ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
    </div>
  )
}
