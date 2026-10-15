# PRD — Professor as an AI Chief of Staff and Strategist

| | |
|---|---|
| **Status** | Draft v0.1 — for discussion, nothing built yet |
| **Date** | 2026-10-15 |
| **Owner** | Bahaa (solo builder) |
| **Beta target** | Friends in waves, from late October 2026; one month of iteration before investors |
| **Pitch line** | *A chief of staff that never forgets a promise — and a strategist that helps you decide what to build with your life.* |

Items marked **[OPEN]** are decisions we have not made. Items marked **[ASSUMPTION]** are beliefs to test with the beta, not facts.

---

## 1. Summary

Professor today is a capable productivity platform: mail, calendar, tasks, habits, finance, library, and an assistant with 27 tools. Each part works, but nothing *remembers* across them and nothing *advises*.

This PRD turns it into an **AI-first platform** built on one loop:

```
COMPASS → GOALS → PLAN BLUEPRINT → REVIEW → BUILD IT → TRACK → ADAPT
          (who you are)  (what to aim for)  (how, with time/money/people)   (you approve)  (becomes real objects)  (radar, brief)  (re-plan when it slips)
```

It has two jobs, which share one memory:

1. **Chief of staff** — nothing falls through the cracks. It watches mail, calendar and tasks for dropped promises, stalled projects and unprotected deadlines, and tells you before they become problems.
2. **Strategist** — it knows your career, age, habits, strengths, weaknesses and history, proposes what you should be aiming for, builds a plan with the time, money and resources it needs, shows it as a schematic, and — once you approve — builds it into your tasks, calendar and habits.

## 2. Problem

People who carry a lot — founders, operators, professionals, people simply trying to run a whole life — lose things in the gaps *between* tools:

- A promise made in an email never becomes a task.
- A project has goals but no next action, and nobody notices for weeks.
- A deadline exists with no time reserved to meet it.
- A week is committed beyond the hours it has.
- A decision is made, forgotten, and later re-argued without the original reasoning.
- Bigger life goals (career move, income, health) stay vague wishes because no one turns them into a plan with real numbers.

Existing tools each cover a slice (mail, calendar, tasks, notes). None owns **the memory across them** or **the advice on top of it**. **[ASSUMPTION]** This pain is strong enough that friends will use a daily brief and approve plans; the beta exists to test that.

## 3. Users

**Beta users:** friends of the owner, invited in waves of 2–3.

| Persona | Description | What they need most |
|---|---|---|
| **A. Multi-hat operator** | Runs 1–5 companies, several mailboxes and calendars | Nothing dropped across companies; one truthful view of load |
| **B. Single-company founder / professional** | One company or one demanding job | Radar, a plan for the year, an honest advisor |
| **C. Life-runner** | Employee or freelancer who wants to "run my life" | Goals, habits, money plan, career strategy |

The product must work with **no companies at all** — persona C is a first-class user, not a degraded one.

## 4. Goals and non-goals

### Goals (beta)
1. A new user finishes **Compass** and approves a first plan in their first session.
2. Users open the **morning brief** most days.
3. The radar finds real dropped commitments that the user then acts on.
4. Users feel the advice is **personal, honest and explained**, not generic.
5. The infrastructure for AI (access, cost, safety, evaluation) is built properly enough that it can scale to a paid product.

### Non-goals (beta)
- The AI **never contacts other people or moves money** on its own (see §9).
- No paid billing, no public sign-up, no admin console beyond what exists.
- No continuous real-time Gmail/Calendar push pipeline (nightly + on-open refresh is enough).
- No full decision-map visualisation (a simple decision journal only).
- No Google OAuth verification (beta runs in Google's test mode).
- No medical, legal, tax or investment advice.

## 5. Success metrics

**[OPEN]** The owner has not yet chosen what success means. These are *proposals*. They matter now for one concrete reason: **a metric can only be reported if the event behind it was recorded from day one — it cannot be reconstructed later.** So the beta logs these events regardless, and we can decide later which to headline.

| Question | Proposed measure | Event we must record |
|---|---|---|
| Did they get started? | Activation: finished Compass **and** approved a first plan | `compass_completed`, `plan_approved` |
| Is it a habit? | Days per week the morning brief is opened | `brief_opened` (per day) |
| Does it deliver value? | Open loops closed; plan items completed | `loop_surfaced`, `loop_closed`, `plan_item_done` |
| Do they trust it? | Suggestion acceptance rate; beliefs corrected | `suggestion_shown/accepted/dismissed`, `belief_edited` |
| Do they stay? | Active in week 4 | derived from any event |
| What does it cost? | AI cost per active user per week | `ai_usage_ledger` |

For investors, the strongest story is usually **retention + habit** (the brief) backed by **value** (loops closed). Trust metrics explain *why*.

## 6. Product principles

1. **Strategist voice.** Analytical, direct, evidence-first. It names trade-offs and says what it would do and why. It is not a cheerleader and not a scold. (Spec in §8.)
2. **Propose, never impose.** The AI proposes; the user approves. Nothing it builds happens before a review step.
3. **Every claim cites its source.** "Because Hasan emailed on Tuesday and nothing is booked." No unexplained advice.
4. **The user owns the picture.** Everything the AI believes about the user is visible, editable and deletable.
5. **Honest about uncertainty.** Plans show assumptions and ranges, not promises. No guarantees about outcomes.
6. **Internal actions only (beta).** It may create tasks, calendar blocks, habits and finance envelopes. It never emails, replies, pays, books or contacts anyone.
7. **Mail is untrusted input.** Text inside an email can never trigger an action by itself.

## 7. Core concepts

| Term | Meaning |
|---|---|
| **Compass** | The user's profile: background, strengths, weaknesses, habits, values, constraints — built by a short interview plus pasted CV/LinkedIn text, always correctable. |
| **Belief** | One thing the AI thinks it knows about the user ("tends to overcommit on Mondays"), with its source and a confidence. Editable and deletable. |
| **Goal** | A target at a horizon (90 days / 1 year / 5 years) in a category (career, money, health, relationships, learning, company). |
| **Plan** | A set of steps toward a goal: milestones, tasks, habits, money, people. |
| **Blueprint** | The visual of a plan: timeline, money needed, hours per week, skills/people required, risks. |
| **Open loop** | Something unresolved that someone is waiting on or that will cause trouble: a promise with no task, a project with no next action, a deadline with no block. |
| **Commitment** | A promise made or received, with who, what, by when, and where it came from. |
| **Decision** | A choice with its inputs, options considered and expected outcome, reviewed later against what happened. |
| **Brief** | The morning plan and evening review. |

## 8. Advisor voice — Strategist

**Rules**
- Lead with the conclusion, then the evidence, then the options.
- Quantify where possible ("11 hours over capacity this week").
- Give a recommendation, not a menu: "I'd drop X, because…".
- Name the cost of every option, including doing nothing.
- Challenge gently when the data disagrees with the user's stated goal.
- Short sentences. No filler, no cheerleading, no moralising.

**Do / don't**

| Don't | Do |
|---|---|
| "Great job! You're doing amazing!" | "You closed 6 of 9 loops this week. The three open all involve the Teradix contract." |
| "You should try to exercise more." | "Your 90-day goal needs 4 workouts a week. You logged 1. Moving two blocks to 07:00 fits your stated energy peak." |
| "This plan will make you rich." | "This plan needs roughly 12 h/week and an upfront cost of X. The main risk is Y. I'd treat the income as a range, not a target." |

**Boundaries.** It is a strategist, not a doctor, lawyer, accountant or financial adviser; on those topics it presents options and trade-offs and says so. It does not predict outcomes with certainty. Tone adapts only in sensitivity (e.g. a bad week), never in honesty.

## 9. Autonomy and safety

### Risk tiers

| Tier | Examples | Beta behaviour |
|---|---|---|
| **0 — Read / think** | Scan, analyse, summarise, draft text | Automatic |
| **1 — Internal, reversible** | Create tasks, habits, calendar blocks on the user's own calendar, finance envelopes | **Only after plan approval**, always with undo and a log |
| **2 — Touches other people** | Send or reply to email, accept/decline invitations, message anyone | **Never automatic in beta.** Drafts only; the user sends. |
| **3 — Money or irreversible** | Payments, deletions of external data | **Not available** |

### Safety rules
- **Prompt injection.** Content of emails, calendar events and documents is data, never instructions. The model's tool permissions are decided by tier, not by what a message says.
- **Audit log.** Every AI action records what, why, on what evidence, and how to undo it.
- **Sensitive topics** (health, money, mental health, family): advice is framed as options with assumptions; professional-advice disclaimers where relevant.
- **Fairness.** Advice using age, background or demographics must be explainable and correctable; the user can switch any belief off.
- **Kill switch.** One setting turns off all AI processing of a user's data.

## 10. Features

Priority: **M** = must for beta, **S** = should, **L** = later.

### F1 — Compass (M)
*As a new user, I want the app to understand me, so its advice fits my life.*

Eight short screens. **Every screen except the consent screen and the final summary can be skipped.** Screens are mocked in the companion page "Compass and AI Architecture".

| # | Screen | Input style |
|---|---|---|
| 0 | Before we start | Plain-language consent: what is read and why; kill switch. Not skippable. |
| 1 | A little about you | Age-range chips, life-stage chips, and an **optional LinkedIn/CV block** (see below). |
| 2 | What are you good at? | **Option chips** (8 shown) with **Show more** (10 more), pick up to 5, plus "add your own". |
| 3 | Where do you struggle? | Same pattern, pick up to 4. |
| 4 | What matters most? | Same pattern, **pick top 3; tap order is the rank**. |
| 5 | How do you actually work? | Habit chips with Show more, plus "add your own". |
| 6 | What limits you? | Grouped chips: hours per week (single), money available (single), fixed commitments (multi, Show more). |
| 7 | How I see you | Editable belief list with sources; "What I don't know yet" for skipped steps. Not skippable. |

**LinkedIn:** LinkedIn does not let apps read a profile from a link, so the block offers *Add LinkedIn PDF* (Resources → Save to PDF) and *Paste profile text*. Either is optional. A fast-tier model extracts roles, companies and years into a fixed schema; the user confirms the result as beliefs.

**Skipping is data.** Skip asks for an optional reason, and the reason decides the system's behavior:
- *Ask me later* — asked once more after 7 days; behavior may fill the gap at low confidence, always shown to the user first.
- *Prefer not to say* — never asked, never inferred; advice avoids the topic and says so.
- *Doesn't apply* — marked not applicable.
- *Just skip* — treated as "ask me later", lower priority.

**Design rules**
- Options are a **static curated list** (no AI call), so the screens cost nothing and are instant. AI is used only to tidy free-text "add your own" answers, to read LinkedIn/CV text, and to write the final summary.
- **Values are never inferred from behavior.** What people do does not show what they care about; values come only from the user.
- Habits answered here carry lower confidence than other answers because self-description is optimistic; they are replaced by measured habits (task/habit logs, Apple Health) over time.

**Acceptance**
- User can finish in under 10 minutes.
- Every belief shows its source and can be edited or removed.
- Skipping every optional screen still produces a usable profile, and the summary lists what is unknown and why.
- A rejected belief is never inferred again.

### F2 — Goals (M)
*As a user, I want goals proposed for me and refined by me.*
- AI proposes goals across horizons and categories from the Compass, each with a one-line "why".
- User edits, adds, rejects, ranks.
- **Acceptance:** each goal has horizon, category, measurable target, and rationale; nothing is saved as a goal without user confirmation.

### F3 — Plan Blueprint (M)
*As a user, I want to see what a goal will take in time, money and people before I commit.*
- Per goal: milestones on a timeline; money (one-off and recurring); hours per week; skills and people needed; top risks with mitigations; assumptions.
- Checks the plan against real capacity (calendar and task load) and shows conflicts.
- **Acceptance:** blueprint renders from a structured plan; every number shows its assumption; capacity conflicts are visible; user can edit any item and the blueprint updates.

### F4 — Review and Build it (M)
*As a user, once I approve a plan, I want it created for me.*
- Review screen: approve / edit / reject **per item**.
- On approval, creates Tier-1 objects: tasks (Do for undated, Schedule for dated), habits, calendar blocks via the existing company-calendar logic, finance envelopes.
- One undo entry for the whole build.
- **Acceptance:** nothing is created before approval; everything created is tagged with its plan; one undo removes all of it; nothing contacts anyone.

### F5 — Open-loops radar (M)
*As a user, I want to be told what is slipping.*
- Finds: promises in mail with no task; projects with no next action; deadlines with no calendar block; tasks postponed 3+ times; unanswered invitations; weeks over capacity.
- Each loop shows evidence and offers: make task, snooze, dismiss, or "not a loop" (feeds learning).
- **Acceptance:** every loop cites its source; dismissals are remembered; no loop is created from message text alone without the model classifying it as a candidate the user confirms.

### F6 — Morning and evening brief (M)
- Morning: today's plan, top 3 loops, one risk, one strategist note tied to a goal.
- Evening: what moved, what slipped, what to carry over.
- Shown as a card on Today; also delivered via Telegram.
- **Acceptance:** generated before the user's configured wake time; opens in under 2 seconds from cache; every item links to its source.

### F7 — Telegram nudges (S)
- Short messages for new high-severity loops or decisions needed, with approve / snooze buttons.
- Respects quiet hours and a daily cap.
- **Acceptance:** never more than N nudges per day (configurable); every nudge is actionable in one tap; Tier-2 actions only produce drafts.

### F8 — Decision journal, lite (S)
- Capture a decision: what, options, why, expected outcome, review date.
- At the review date, the AI asks how it went and records the outcome.
- **Acceptance:** decisions are stored with review dates; the radar surfaces overdue reviews.

### F9 — Weekly review and adapt (S)
- Plan versus reality for each goal; proposes re-planning when the gap grows.
- **Acceptance:** shows planned vs actual hours and milestones; proposed changes go through the same review gate as F4.

### Later (L)
Decision map visualisation; continuous Gmail/Calendar push; relationship memory; delegation suggestions; outward actions with approval; team/shared plans; billing.

## 11. Architecture (high level)

```
Browser / Telegram
      │  (user JWT)
      ▼
 Edge function "ai-gateway"  ── checks user, cap, kill-switch ──► model provider
      │                         writes ai_usage_ledger (one row per call)
      │
      ├── structured outputs (JSON schemas) → Compass, Goals, Plans, Loops, Briefs
      ├── memory store (Postgres, RLS)      → beliefs, commitments, decisions, plans
      ├── scheduled jobs (nightly + on-open) → radar, briefs
      └── action queue (Tier 1 only, audit + undo)
```

**Reuse what exists:** assistant tools and policy, `mailNeeds` / smart view, `automation.ts` rules, task / habit / finance stores and undo, company-calendar scheduling, entitlements, Telegram bot, Supabase edge-function patterns.

**New:** AI gateway, usage ledger, memory tables, structured-output schemas, eval harness, jobs for radar and briefs.

### Data model (sketch)
`ai_usage_ledger` · `ai_calls` (trace: prompt id/version, inputs hash, output) · `profiles_compass` · `beliefs` · `goals` · `plans` · `plan_items` · `commitments` · `open_loops` · `decisions` · `briefs` · `suggestions` (shown / accepted / dismissed) · `events` (analytics) · `user_ai_keys` (encrypted).

All tables are per-user with RLS, gated by the existing entitlements function.

### Engineering practices
1. **Structured outputs** — every AI result matches a schema; invalid output is rejected and retried, never rendered.
2. **Eval harness** — a fixed set of example people/inboxes; a script that scores "did it find the dropped promise", "does the plan fit the stated hours"; run on every prompt or model change.
3. **Prompt versioning** — each prompt has an id and version recorded with every result.
4. **Model routing** — cheap models for classification and summaries, strongest for plan generation.
5. **Idempotent jobs** — a retried nightly run never double-creates anything.
6. **Observability** — every call traceable and replayable; cost per user visible.

## 12. AI access and cost

**Model: "my key with a monthly cap, then bring your own."**
- Beta users call AI through the gateway using the owner's key, up to a **per-user monthly dollar cap** (adjustable per user; starting value set after measuring real usage in week 1 — **[OPEN]**).
- At the cap, AI features pause with a clear message and an option to add the user's own key.
- User keys are stored **encrypted** (not in the browser, not in plain preferences).
- The ledger is the single source of truth; the monthly total is a sum over it.

## 13. Privacy and data governance

- Data minimisation: send the model only what the task needs; summarise before storing where possible.
- No training on user data; state this plainly in onboarding.
- Per-user export and delete (all beliefs, goals, plans, loops, decisions).
- Retention defaults **[OPEN]**; company-level context isolation for multi-company users.
- Beta users are told exactly what is read (mail metadata/text, calendar, tasks) and why.
- Google access runs in test mode: up to 100 named testers; tokens expire weekly in test mode, so testers re-connect Google weekly. Verification (and its security assessment) is a pre-launch item, not a beta item.

## 14. Beta plan

| Dates | Phase | Outcome |
|---|---|---|
| Oct 16–22 | A. Foundation | AI gateway, usage ledger, kill switch, Compass storage, event logging |
| Oct 23–29 | B. Advisor | Goals, Blueprint, Review + Build it, radar, brief |
| Oct 30–31 | C. Polish + invite | Onboarding, empty states, first wave (2 friends) |
| Nov | Iterate | Weekly 15-minute feedback per friend; waves of 2–3 |
| Dec | Investor prep | Metrics, story, demo |

Schedule is flexible by design: the owner is also learning the infrastructure. Each chunk is a separate small change, individually reviewable and testable.

## 15. Risks

| Risk | Mitigation |
|---|---|
| Advice feels generic | Compass + cited evidence + user-editable beliefs |
| Wrong advice on sensitive topics | Tiered framing, disclaimers, options not directives |
| Prompt injection via email | Mail is data; tier-based permissions; no Tier-2 actions |
| AI cost overrun | Per-user cap, ledger, model routing |
| Solo builder, tight timeline | Small chunks; cut Telegram and weekly review first |
| Google or Microsoft bundle similar features | Compete on cross-tool memory and advisory depth |
| Friends churn after novelty | Habit design around the brief; measure week-4 retention |
| Privacy concerns | Visible beliefs, export/delete, kill switch, plain-language disclosure |

## 16. Open questions

1. **[OPEN]** Which success metric is the headline for investors? (§5 — proposals only.)
2. **[OPEN]** Monthly cap value per friend — set after measuring real usage.
3. **[OPEN]** Data retention defaults.
4. **[OPEN]** Which friend is the first single-company / life-runner tester, and what is their biggest pain?
5. **[OPEN]** How personal should the Compass go by default (what is asked, what is inferred)?
6. **[OPEN]** Brief timing: fixed wake time or learned from the user?
7. **[OPEN]** Name and framing of the advisor (does it keep the existing assistant's name and face?).

## 17. Decisions made so far

| Decision | Choice | Date |
|---|---|---|
| Advisor voice | Strategist | 2026-10-15 |
| Autonomy at start | Propose, user approves | 2026-10-15 |
| Outward actions (email, payments) | Never, in beta | 2026-10-15 |
| AI access | Owner's key with monthly cap, then user's own key | 2026-10-15 |
| Proactive channels | Today card, Telegram nudges, morning + evening brief | 2026-10-15 |
| Always-on approach | Continuous (target), nightly + on-open for beta | 2026-10-15 |
| Timeline | Beta from end of October; investor conversations after a month of iteration | 2026-10-15 |
