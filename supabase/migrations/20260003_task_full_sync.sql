-- Only part of a task reached the server. Its notes, priority, subtasks,
-- attachments, links, board column and — worst — the id of the calendar event
-- it created all stayed in the browser that made them. On a second device the
-- task therefore looked unscheduled, and the Tasks page re-scheduled it,
-- putting a duplicate block on the calendar every time.
--
-- Safe to run more than once.

alter table public.tasks add column if not exists task_type      text;
alter table public.tasks add column if not exists priority       text;
alter table public.tasks add column if not exists board_status   text;
alter table public.tasks add column if not exists calendar_id    text;
alter table public.tasks add column if not exists gcal_event_id  text;
alter table public.tasks add column if not exists parent_task_id text;
alter table public.tasks add column if not exists captured_via   text;
alter table public.tasks add column if not exists urgent         boolean not null default false;

-- Subtasks, files and links, each a list of small objects.
alter table public.tasks add column if not exists checklist   jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists links       jsonb not null default '[]'::jsonb;

-- The description column was carrying the task's *type* — the only way to keep
-- it at all without a column of its own — which left the actual notes nowhere
-- to go. Move those values into task_type and free the column. Only the eight
-- known type values are touched, so anything a person wrote is left alone.
update public.tasks
   set task_type = description
 where task_type is null
   and description in ('meeting','call','followup','email','research','study','deepwork','do');

update public.tasks
   set description = null
 where description in ('meeting','call','followup','email','research','study','deepwork','do');
