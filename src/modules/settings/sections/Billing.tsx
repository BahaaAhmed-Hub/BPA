import { useState } from 'react'
import { Segmented } from '@/components/ui'
import { Download, Check } from 'lucide-react'
import { ICON, STROKE } from '@/lib/type'
import { Block, DRow, GhostPill, PillValue } from '../ui'
import { PILL_BASE } from '../pillStyles'

function VisaBadge() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 30, height: 19, borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-info)',
      color: 'var(--sb-ink-on-dark)', fontSize: 'var(--sb-t-meta)', fontWeight: 700, fontStyle: 'italic',
      letterSpacing: '0.04em', flexShrink: 0,
    }}>VISA</span>
  )
}

// ─── Billing Section (11A right column) ──────────────────────────────────────

type BillingCycle = 'monthly' | 'annual'
type PlanId = 'free' | 'plus' | 'pro'

interface BillingPlan {
  id: PlanId
  name: string
  monthlyPrice: number
  annualPrice: number   // total per year
  tagline: string
  features: string[]
  highlight?: boolean   // visually promoted tier
}

const BILLING_PLANS: BillingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    monthlyPrice: 0,
    annualPrice: 0,
    tagline: 'Everything you need to get started',
    features: [
      '1 Google account',
      '2 companies',
      'Tasks, Habits & Finance basics',
      '50 AI messages / month',
      'Web app only',
    ],
  },
  {
    id: 'plus',
    name: 'Plus',
    monthlyPrice: 18,
    annualPrice: 180,
    tagline: 'For professionals managing real work',
    features: [
      '3 Google accounts',
      '5 companies',
      'All modules including Mail',
      '500 AI messages / month',
      'Calendar intelligence',
      'Finance planning & lock',
      'Apple Health sync',
    ],
    highlight: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: 30,
    annualPrice: 300,
    tagline: 'No limits — for power users and founders',
    features: [
      'Unlimited Google accounts',
      'Unlimited companies',
      'All modules + early access',
      'Unlimited AI messages',
      'Full automation engine',
      'Priority support',
    ],
  },
]

const CURRENT_PLAN: PlanId = 'pro'

export function BillingSection() {
  const [cycle, setCycle] = useState<BillingCycle>('annual')

  const INVOICES = [
    { date: '14 Mar 2026', desc: 'Professor Pro · annual',   amount: '$300.00' },
    { date: '14 Mar 2025', desc: 'Professor Pro · annual',   amount: '$300.00' },
    { date: '02 Feb 2025', desc: 'Professor Plus · monthly', amount: '$18.00' },
  ]

  const annualSavingPct = Math.round((1 - (BILLING_PLANS[2].annualPrice / 12) / BILLING_PLANS[2].monthlyPrice) * 100)

  return (
    <div>
      {/* The tiers are choices, each its own card, so they sit on the panel's ground
          under a titled bare Block rather than inside another card. */}
      <Block bare title="Plan" sub="Pick a tier and how often you are billed.">
      {/* ── Billing cycle toggle ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Segmented
          options={[
            { label: 'Monthly', value: 'monthly' },
            { label: `Annual  ·  save ${annualSavingPct}%`, value: 'annual' },
          ]}
          value={cycle}
          onChange={v => setCycle(v as BillingCycle)}
        />
      </div>

      {/* ── Plan cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        {BILLING_PLANS.map(plan => {
          const isCurrent = plan.id === CURRENT_PLAN
          const price = cycle === 'annual' && plan.annualPrice > 0
            ? Math.round(plan.annualPrice / 12)
            : plan.monthlyPrice

          return (
            <div
              key={plan.id}
              style={{
                borderRadius: 'var(--sb-r-card)',
                border: `var(--sb-border-width) solid ${isCurrent ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
                background: isCurrent ? 'var(--sb-accent-tint)' : 'var(--sb-card)',
                padding: '16px 14px 14px',
                display: 'flex', flexDirection: 'column', gap: 0,
                boxShadow: isCurrent ? '0 0 0 1px var(--sb-accent)' : 'var(--sb-shadow-card)',
                position: 'relative',
              }}
            >
              {/* plan name + current badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontFamily: 'var(--sb-font-display)', fontSize: 'var(--sb-t-body)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>{plan.name}</span>
                {isCurrent && (
                  <span style={{
                    fontSize: 'var(--sb-t-micro)', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
                    background: 'var(--sb-accent)', color: 'var(--sb-accent-ink)',
                    padding: '2px 6px', borderRadius: 'var(--sb-r-chip)',
                  }}>CURRENT</span>
                )}
              </div>

              {/* price */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginBottom: 2 }}>
                {plan.monthlyPrice === 0 ? (
                  <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--sb-ink-1)', lineHeight: 1 }}>Free</span>
                ) : (
                  <>
                    <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--sb-ink-1)', lineHeight: 1 }}>${price}</span>
                    <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>/mo</span>
                  </>
                )}
              </div>

              {/* billing note */}
              <p style={{ margin: '0 0 10px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', minHeight: 14, lineHeight: 1.4 }}>
                {plan.monthlyPrice === 0
                  ? 'No card required'
                  : cycle === 'annual'
                    ? `$${plan.annualPrice} billed annually`
                    : 'billed monthly'}
              </p>

              {/* features */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14, flex: 1 }}>
                {plan.features.map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                    <Check size={10} style={{ color: 'var(--sb-positive)', flexShrink: 0, marginTop: 2 }} strokeWidth={STROKE.active} />
                    <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', lineHeight: 1.4 }}>{f}</span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              {isCurrent ? (
                <div style={{
                  ...PILL_BASE, justifyContent: 'center', fontSize: 'var(--sb-t-meta)', fontWeight: 600,
                  background: 'var(--sb-accent)', color: 'var(--sb-accent-ink)',
                  cursor: 'default',
                }}>Current plan</div>
              ) : plan.id === 'free' ? (
                <button
                  style={{ ...PILL_BASE, justifyContent: 'center', fontSize: 'var(--sb-t-meta)', cursor: 'pointer', color: 'var(--sb-ink-3)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', fontFamily: 'inherit', fontWeight: 500 }}
                  onClick={() => alert('Downgrade to Free — not yet connected')}
                >Downgrade</button>
              ) : (
                <button
                  style={{ ...PILL_BASE, justifyContent: 'center', fontSize: 'var(--sb-t-meta)', cursor: 'pointer', color: 'var(--sb-ink-1)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', fontFamily: 'inherit', fontWeight: 600 }}
                  onClick={() => alert('Upgrade — not yet connected')}
                >Upgrade to {plan.name}</button>
              )}
            </div>
          )
        })}
      </div>

      </Block>

      {/* ── Subscription and billing fields ── */}
      <Block title="Subscription" sub="What you are on, and how it is paid for.">
        <DRow label="Professor Pro" sub="Renews 14 March 2027">
          <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'var(--sb-accent)', color: 'var(--sb-accent-ink)', padding: '2px 6px', borderRadius: 'var(--sb-r-chip)' }}>ANNUAL</span>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)', lineHeight: 1 }}>$300</p>
            <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>per year</p>
          </div>
        </DRow>

        <DRow label="Payment method">
          <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>Visa ending 4417 · expires 09/28</span>
          <VisaBadge />
          <GhostPill>Change</GhostPill>
        </DRow>

        <DRow label="Billing email" sub="Invoices are sent here every renewal">
          <PillValue>eng.bahaa.a@gmail.com</PillValue>
        </DRow>

        <DRow label="VAT / tax ID" sub="Appears on every invoice">
          <GhostPill>Add a tax ID</GhostPill>
        </DRow>

        <DRow label="Seats" sub="Personal licence — one person" last>
          <PillValue>1 of 1</PillValue>
        </DRow>
      </Block>

      {/* ── Invoices ── */}
      <Block title="Invoices" sub="Every charge, newest first.">
        {INVOICES.map((inv, i) => (
          <div key={`${inv.date}-${i}`} className="sx-row" style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 0',
            borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
          }}>
            <span style={{ width: 90, flexShrink: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums' }}>{inv.date}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.desc}</span>
            <span style={{ fontSize: 'var(--sb-t-label)', fontFamily: 'var(--sb-font-num)', fontWeight: 600, color: 'var(--sb-ink-1)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{inv.amount}</span>
            <button title={`Download ${inv.date} invoice`} style={{
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)',
              padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0,
            }}><Download size={ICON.sm} /></button>
          </div>
        ))}
        <DRow label="All invoices" last>
          <GhostPill icon={Download}>Download all</GhostPill>
        </DRow>
      </Block>

      {/* ── Cancel — the danger zone ── */}
      <section style={{ marginBottom: 28 }}>
        <div style={{ margin: '0 0 10px 2px' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-negative-deep)' }}>Danger zone</h3>
        </div>
        <div style={{
          background: 'var(--sb-card)', border: '1px solid color-mix(in srgb, var(--sb-negative) 30%, transparent)',
          borderRadius: 'var(--sb-r-card)', padding: '8px 20px', boxShadow: 'var(--sb-shadow-control)', minWidth: 0,
        }}>
          <DRow label="Cancel plan" sub="Cancelling keeps your data readable until the term ends." last>
            <GhostPill tone="rust">Cancel plan</GhostPill>
          </DRow>
        </div>
      </section>
    </div>
  )
}
