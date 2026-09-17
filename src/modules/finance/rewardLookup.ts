// ─── Looking a bank's rewards programme up ───────────────────────────────────
//
//  Typing a card's earn rate and point value in by hand means finding a PDF on
//  a bank's website, which is why nobody ever does it and why the figures on
//  this screen would otherwise stay empty for ever. So the bank's name is the
//  question and the model answers it.
//
//  What this is honest about:
//
//  - **It is a lookup, not a measurement.** Whatever comes back is marked
//    `suggested`, every screen that draws it says so, and one tap on the figure
//    makes it `yours` — after which nothing here overwrites it, including a
//    later lookup. A bank changes its programme and the app has no way to know;
//    the person holding the statement does.
//  - **It cannot reach the bank's website.** There is no fetch here and no
//    search: it is the model's own reading of a well-known programme. So the
//    answer carries a sentence saying where the figures are supposed to come
//    from, and the panel puts "check your statement" beside them rather than
//    presenting them as fact.
//  - **A refusal is an answer.** A bank it does not know, or a card it cannot
//    tell apart from three others at the same bank, comes back as
//    `{ known: false, why }` and the fields stay empty. A scheme half-filled
//    with confident nonsense is worse than an empty one, because the empty one
//    says it is empty.

import * as professor from '@/lib/professor'
import type { Currency } from './types'
import type { RewardScheme } from './cardRewards'

export interface LookupResult {
  known: boolean
  /** Present when `known`. Always `source: 'suggested'`. */
  scheme?: RewardScheme
  /** Present when not — what it could not answer, in a sentence. */
  why?: string
}

const SYSTEM = `You answer questions about credit-card rewards programmes.

Reply with JSON only, no prose, no code fence. One of two shapes.

When you know the programme:
{"known":true,
 "programme":"<the programme's own name, or the bank's card name>",
 "earnPos":<points earned per 1 unit of currency spent in person>,
 "earnOnline":<points per 1 unit spent online; same as earnPos when the bank does not differentiate>,
 "pointValue":<what one point is worth, in the same currency, when redeemed for cash or statement credit>,
 "monthlyCap":<maximum points per month, or 0 for none>,
 "expiryMonths":<months before points lapse, or 0 for never>,
 "note":"<one sentence: what the rates are, and where a cardholder would verify them>"}

When you do not:
{"known":false,"why":"<one short sentence saying what you could not determine>"}

Rules you must follow:
- earnPos and earnOnline are points per ONE unit of the currency. A card giving
  "1 point per 10 EGP" is 0.1, not 1 and not 10.
- pointValue is in the SAME currency. Never a percentage, never a ratio.
- If the bank runs several cards with different rates and the name given does
  not say which, answer known:false and say so. Do not average them.
- If you are not confident about the actual published figures, answer
  known:false. A wrong number here goes straight into somebody's accounts.
- Never invent a programme for a bank you do not recognise.`

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return isFinite(n) && n > 0 ? n : 0
}

/**
 * Ask what a card at this bank earns.
 *
 * `cardName` matters as much as the bank: "CIB" alone cannot be answered, while
 * "CIB Platinum" can — which is exactly the case the prompt is told to refuse
 * rather than average away.
 */
export async function lookUpRewards(
  bank: string, cardName: string, currency: Currency,
): Promise<LookupResult> {
  const named = [bank.trim(), cardName.trim()].filter(Boolean).join(' — ')
  if (!named) return { known: false, why: 'No bank name has been given yet.' }

  let raw: string
  try {
    raw = await professor.call(SYSTEM,
      `Bank / card: ${named}\nThe card is denominated in ${currency}.\n` +
      `What does it earn, and what is a point worth in ${currency}?`)
  } catch (e) {
    // A missing key is the ordinary case on a fresh browser and is not a
    // failure of the lookup — it says which, so the panel can point at
    // Settings rather than at the bank.
    return { known: false, why: e instanceof Error ? e.message : 'The lookup could not be made.' }
  }

  const body = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(body) as Record<string, unknown>
  } catch {
    return { known: false, why: 'The answer came back in a shape we could not read.' }
  }

  if (parsed.known !== true) {
    const why = typeof parsed.why === 'string' && parsed.why.trim()
      ? parsed.why.trim()
      : `Nothing is known about ${named}'s rewards programme.`
    return { known: false, why }
  }

  const pos = num(parsed.earnPos)
  const online = num(parsed.earnOnline) || pos
  const pointValue = num(parsed.pointValue)
  // Said it knew and then gave nothing to go on. Treated as not knowing, or
  // the card is left carrying a scheme that is dormant *and* claims a source.
  if (!pos && !online) return { known: false, why: `No earn rate came back for ${named}.` }
  if (!pointValue) return { known: false, why: `No point value came back for ${named}.` }

  const scheme: RewardScheme = {
    earn: { pos, online },
    pointValue,
    monthlyCap: num(parsed.monthlyCap) || undefined,
    expiryMonths: num(parsed.expiryMonths) || undefined,
    source: 'suggested',
    programme: typeof parsed.programme === 'string' ? parsed.programme.trim() || undefined : undefined,
    note: typeof parsed.note === 'string' ? parsed.note.trim() || undefined : undefined,
    checkedAt: new Date().toISOString().slice(0, 10),
  }
  return { known: true, scheme }
}
