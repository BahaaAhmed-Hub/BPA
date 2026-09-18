-- Which stores to check for an item — the ones *you picked*, not the ones its
-- category implies.
--
-- The item detail has had a store picker since the module landed, and it wrote
-- `suggestedStores` — a field the store recomputes from `item.category` on
-- every enrich and that no column ever held. So a pill lit, the next render put
-- it back, and the price watch never read it: it re-derived the category match
-- itself. The control was drawn and connected to nothing.
--
-- `store_ids` is the answer to a different question from the category match, so
-- it is its own column. Empty means "nobody has chosen" — and the category
-- match is then what is checked, which is the behaviour every existing item
-- already has.

alter table public.shopping_items
  add column if not exists store_ids uuid[] not null default '{}';
