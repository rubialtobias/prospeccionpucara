-- Borradores de email editables desde el panel.
-- Pegar en Supabase -> SQL Editor -> New query -> Run. Se puede correr más de una vez.
alter table public.leads add column if not exists borrador jsonb;
revoke update on public.leads from authenticated;
grant update (estado, nota, historial, borrador, actualizado_panel) on public.leads to authenticated;
