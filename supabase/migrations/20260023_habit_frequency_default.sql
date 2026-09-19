-- The app's saveHabitsToDB upsert never includes the `frequency` column,
-- so every INSERT fails with "null value in column frequency violates not-null constraint".
-- Adding a default makes new rows from the app succeed without changing existing behaviour.
alter table public.habits
  alter column frequency set default 'daily';
