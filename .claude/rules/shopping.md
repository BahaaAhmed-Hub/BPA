---
paths:
  - "src/modules/finance/shopping/**"
  - "src/modules/finance/screens/ShoppingScreen.tsx"
  - "src/store/shoppingStore.ts"
---

# Shopping — lists, the board, stores and the price watch

Loaded when a file this rule's `paths` names is read or edited — it is not
in context on every turn, which is the whole point. The root `CLAUDE.md`
holds what is true everywhere; this holds what is true here.

## Shopping — an item is edited where it is
`shopping/ItemFields.tsx` is the whole of an item, in **one** component, drawn by
both views — the list's expanded row and the board's opened card. An item had
four editable fields (category, notes, max price, and a store picker that wrote
to a derived field); everything else was set once in the Add modal and could
never be corrected, its **name** included.
- **The contract is the calendar composer's.** A select, a pill or a tick is a
  decision and goes the moment it is made; words are held 700ms so a keystroke
  is not a request. `useHeldText` flushes on blur, on Enter **and on unmount** —
  closing the row is not how you lose the sentence you just typed — and takes a
  value arriving from outside only while nothing is half-typed, or another
  device's write lands on your caret.
- **The name is editable in the row header**, not only down in the editor: it is
  the field you most want to correct and it is the one you are already looking
  at. Escape puts it back.
- **A purchased item opens too.** What it actually cost is the thing most worth
  correcting and the confirm dialog asked once and then never again — so *Paid*,
  *Bought at* and *Bought on* are fields, and the tick is a toggle rather than a
  one-way door. Coming off `purchased` clears the three, or history shows a date
  for something that is back on the list.
- **The currency list is what you have rates for** (`fx.loadRates()` + the base +
  the item's own), never a hard-coded three — which is how a figure in a fourth
  currency becomes uneditable.
- **Stores are editable too** (`shopping/StoresTab.tsx`). `updateStore` was in the
  store from the first commit and no screen ever called it, so a typo in a URL
  meant deleting the store — which takes its price history with it, the
  snapshots being `on delete cascade` — and adding it again. A row opens on the
  same write-through contract, and says what each store is actually *doing*:
  how many live items it is checked for, or that its categories match nothing.

## Shopping — which stores an item is checked at
`storesToCheck(item, stores)` in `shoppingStore.ts` is the only answer, read by
the price watch, by *Optimize trip* and by the picker that draws it. **Your pick
wins where you have made one; where you have not, the category match stands in.**
- Those are two questions and used to be one field. The picker wrote
  `suggestedStores` — which `enrichItems` recomputes from `item.category` on the
  very next render and which no column ever held — and `refreshPrices` read
  neither, re-deriving the category match itself. So a pill lit, the next render
  put it back, and nothing about the price check ever changed. The control was
  drawn and connected to nothing.
- **`store_ids` is its own column** (`20260019`), written by `upsertItem` behind
  the same drop-only-the-column-the-error-names retry `financeDb` uses, and
  `storeIdsSupported()` lets the caption say when the choice is only being kept
  on this device. Empty means nobody has chosen, which is what every item
  written before the column already did — so nothing changes for them.
- **The caption says which of the two is in force**, and names the category when
  no store carries it. An empty row of pills read as "nowhere".
- `suggestedStores` stays, derived and documented as unwritable.

## Shopping — two views, and what each one answers
`shopping-layout` (`list` | `board`), a `Segmented` in the header beside the
Lists / Stores / History one.
- **List** files each list under the week or month it is scheduled for: it
  answers *when*. **Board** (`shopping/BoardView.tsx`) is a column per list with
  its items as cards, so a whole week's lists are side by side — which the list
  view cannot do once either list has more than a few items on it.
- **Week / Month is withdrawn on the board**, because it is a question about the
  list layout and the history and has nothing to say about columns.
- **Dragging a card to another column is how an item changes list** — the same
  thought as the List field in its editor, done with the hand. dnd-kit with a
  `DragOverlay` and the Budget screen's two sensors, because the board is used on
  an iPad and `dragstart` never fires for a finger.
- **"No list" is a column like any other and is always drawn**, or an item has no
  way *out* of a list. `NO_LIST` is not a group id and `handleAddItem` maps it to
  `undefined`, or the string would be written into a uuid foreign key.
- **The board measures its own height.** `height: 100%` is no use: the Shopping
  screen sits in a content-sized column, so its own 100% resolved to 269px of a
  1000px window — which the list view hides by flowing and a horizontal board
  cannot. A `calc(100vh - 212px)` would be a guess about every bar above it, the
  mistake the calendar panel made. `useFillsTheWindow` asks where the board
  actually starts and takes the rest, and asks again on resize.
- Both views and the stores page are in `scripts/ink-audit.mjs` now — the module
  was added without one.

## Shopping — the Realtime channel, and the reload storm behind it
Three faults in one subscription, all of which made the module feel slow the
longer a tab stayed open.
- **`startRealtime` never tore the previous channel down**, though
  `beginLiveSync` does exactly that for liveSync two lines above the call to it —
  the shopping channel was bolted on beside it and did not follow the rule. Each
  call *overwrote* `_stopRealtime` with the newest channel's remover, so seven
  auth events left seven live channels and six unremovable ones. Every one of
  them answered the same change with its own `loadAll()` — two round trips each.
  It now calls `get().stopRealtime()` first; verified 4 starts → 3 removals,
  exactly one live.
- **A change is a reason to reload once, not once per row.** The four
  subscriptions share one debounced `nudge` (`RELOAD_QUIET_MS`, 400ms): a price
  refresh writing a snapshot per item used to be a full reload apiece. Verified
  20 events → 1 reload, and `stopRealtime` cancels one still pending.
- **`shopping_price_snapshots` cannot be filtered by `user_id`** — it has no such
  column, being owned through `item_id` — so that one is held to RLS and the
  debounce instead, and says so.
- **`addSnapshots` inserts the batch in one request.** One call per snapshot was
  the same storm on the write side, and each insert came back as its own
  Realtime event.

## Shopping — a reload is not an empty ledger
The list view rendered its empty state whenever the store was empty, so every
reload flashed **"No shopping lists yet"** about lists that were on their way —
the most misleading thing the screen could say. It now shows *Fetching your
lists…* while `loading` is true **and** there is nothing yet; once there is
something on screen a reload is silent, because flashing a spinner over data you
are already reading is worse than the wait. An account that is genuinely empty
still gets its empty state — verified both ways.

## Shopping — where it lives now
It is a rail module (`ShoppingModule`, id `shopping`), no longer a tab inside
Finance; see "Finance — navigation is three groups" in `finance.md` for why it
still answers to the finance lock. `ink-audit.mjs` reaches it through the rail.
