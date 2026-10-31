import { useState } from 'react'
import { Segmented } from '@/components/ui'
import { baseCurrency } from '@/modules/finance/fx'
import { useFinanceStore } from '@/modules/finance/financeStore'
import { loadRewardSettings, saveRewardSettings, isDormant, schemeFor, totalPoints, type RewardSettings } from '@/modules/finance/cardRewards'
import { acct, group } from '@/modules/finance/format'
import { Block, FieldRow, Toggle } from '../ui'

// ─── Settings → Finance → CARD POINTS ────────────────────────────────────────
//
//  The per-card figures live on the card, in its own window, because that is
//  where they differ. What belongs here is what is true of all of them: whether
//  points are drawn as money at all, over what stretch, and what a point is
//  worth on a card whose own programme has not been filled in.
//
//  That last one starts at **nothing**, deliberately. A default of 0.50 would
//  put a figure in EGP on a screen full of measured ones, derived from a number
//  nobody gave. It is a decision, and the block says so.

export function CardPointsSection() {
  const [cfg, setCfg] = useState<RewardSettings>(loadRewardSettings)
  const { accounts, transactions } = useFinanceStore()

  function patch(p: Partial<RewardSettings>) {
    const next = { ...cfg, ...p }
    setCfg(next); saveRewardSettings(next)
  }

  const cards = accounts.filter(a => a.accountType === 'credit_card')
  const withScheme = cards.filter(a => !isDormant(schemeFor(a.id)))
  const summary = totalPoints(accounts, transactions, { window: cfg.window })

  return (
    <Block title="Card points" sub="What is true of every card — the per-card figures live on the card">
      {cards.length === 0 ? (
        <p className="sx-row" style={{ margin: 0, padding: '14px 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.55 }}>
          No credit cards yet. A card's earn rate and point value are set on the card
          itself, in Balances → the card → edit, where they differ from card to card.
        </p>
      ) : (
        <>
          <p className="sx-row" style={{ margin: 0, padding: '14px 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.55, borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
            {withScheme.length === 0
              ? <>None of your {cards.length === 1 ? 'card has' : `${cards.length} cards have`} a
                 rewards programme set. Open a card and use <b style={{ fontWeight: 600 }}>Look it up</b> —
                 the figures come back as a suggestion to check, never as fact.</>
              : <>{withScheme.length} of {cards.length} {cards.length === 1 ? 'card earns' : 'cards earn'} points.
                 What the points are worth is <b style={{ fontWeight: 600 }}>never counted as money</b> —
                 not in a balance, a goal, a plan or a piece of advice. A card is what you
                 spend through, not what you hold.</>}
          </p>

          <FieldRow label="Show what points are worth" sub="Beside the count, in your own currency">
            <Toggle checked={cfg.showAsMoney} onChange={v => patch({ showAsMoney: v })} />
          </FieldRow>

          <FieldRow label="Count points over" sub="A statement talks about a year; a cap talks about a month">
            <Segmented
              value={cfg.window}
              onChange={v => patch({ window: v as RewardSettings['window'] })}
              options={[{ value: 'month', label: 'This month' }, { value: 'year', label: 'This year' }]}
            />
          </FieldRow>

          <FieldRow label="A point is worth" sub="Only where a card's own programme does not say. Blank means no answer, and no figure is drawn.">
            <input
              type="number" min={0} step="0.01"
              value={cfg.defaultPointValue || ''}
              placeholder="no answer"
              onChange={e => patch({ defaultPointValue: Number(e.target.value) || 0 })}
              style={{
                width: 120, padding: '7px 10px', borderRadius: 'var(--sb-r-chip)',
                border: 'var(--sb-border-width) solid var(--sb-border)',
                background: 'var(--sb-field)', color: 'var(--sb-ink-1)',
                fontSize: 'var(--sb-t-body-s)', outline: 'none', fontFamily: 'inherit',
              }} />
          </FieldRow>

          {summary.rows.length > 0 && (
            <p className="sx-row" style={{ margin: 0, padding: '14px 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', lineHeight: 1.55 }}>
              {group(summary.rows.reduce((t: number, r) => t + r.total, 0))} points
              {cfg.showAsMoney && summary.worthInBase !== null &&
                <> — worth about {acct(summary.worthInBase, { currency: baseCurrency() })}</>}
              {' '}{cfg.window === 'month' ? 'this month' : 'this year'}.
              {summary.noRate.length > 0 && (
                <> {summary.noRate.join(' and ')} not counted — no exchange rate has been given.</>
              )}
              {summary.rows.some(r => r.cashUse > 0) && (
                <> Cash taken on a card earns nothing and is left out.</>
              )}
            </p>
          )}
        </>
      )}
    </Block>
  )
}
