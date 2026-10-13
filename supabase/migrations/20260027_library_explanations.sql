-- ─── Library 2d — a quote's explanation ──────────────────────────────────────
-- Stored beside the quote so it is generated once, not every time the board is
-- opened: an explanation costs a model call and a person re-reading one should
-- not pay for it twice. The value is the JSON the explainer returned
-- ({"meaning": …, "apply": […]}); the app parses it and shows it as two parts.
--
-- A plain nullable column on a table whose policy (20260026) is already
-- ownership AND has_module('library'), so there is nothing to gate again.
-- Safe to run more than once.
alter table public.library_quotes add column if not exists explanation text;
