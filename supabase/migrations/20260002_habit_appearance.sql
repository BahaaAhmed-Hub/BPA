-- Habits carried only their name, frequency and active flag. Everything that
-- makes a habit recognisable — its picture, its emoji, its colour — and
-- everything that makes a counter a counter — type, goal, unit — lived in the
-- browser that created it. Open the app on a second device and every habit came
-- back nameless in appearance: no picture, and the ✅ that dbSync falls back to.
--
-- Safe to run more than once.

alter table public.habits add column if not exists emoji text;
alter table public.habits add column if not exists color text;
alter table public.habits add column if not exists type  text;
alter table public.habits add column if not exists goal  numeric;
alter table public.habits add column if not exists unit  text;

-- A downscaled JPEG held as a data URL. Text rather than a storage reference so
-- a picture already on a device can be pushed up without a second round trip;
-- if these grow, move them to Supabase Storage and keep a URL here instead.
alter table public.habits add column if not exists image text;

alter table public.habits add column if not exists created_at timestamptz default now();
