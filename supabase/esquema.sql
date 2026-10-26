-- Prospección Pucará: tablas y permisos.
-- Pegar entero en Supabase -> SQL Editor -> New query -> Run. Se puede correr más de una vez.

-- Quiénes pueden ver y editar el panel
create table if not exists public.acceso (
  email text primary key
);
alter table public.acceso enable row level security;
-- Sin políticas: nadie la lee desde el navegador. Solo la usa la función de abajo.

insert into public.acceso (email) values
  ('tobias.pucaratech@gmail.com'),
  ('tobiasrubial05@gmail.com'),
  ('martincoronelconsultor@gmail.com')
on conflict do nothing;

-- true si el usuario que inició sesión está en la lista de acceso
create or replace function public.tiene_acceso()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.acceso where email = lower(auth.jwt() ->> 'email'));
$$;

-- Un lead por perfil de LinkedIn. "datos" tiene todo lo que arman los scripts;
-- estado, nota e historial también se editan desde el panel.
create table if not exists public.leads (
  linkedin_url text primary key,
  datos jsonb not null,
  estado text not null default 'nuevo',
  nota text not null default '',
  historial jsonb not null default '[]',
  borrador jsonb,
  actualizado_panel timestamptz,
  actualizado timestamptz not null default now()
);
alter table public.leads enable row level security;

drop policy if exists "ver leads" on public.leads;
create policy "ver leads" on public.leads
  for select to authenticated using (public.tiene_acceso());

drop policy if exists "editar leads" on public.leads;
create policy "editar leads" on public.leads
  for update to authenticated using (public.tiene_acceso()) with check (public.tiene_acceso());

-- Para proyectos creados antes de los borradores
alter table public.leads add column if not exists borrador jsonb;

-- Desde el panel solo se pueden cambiar estado, nota, historial y el borrador del email
revoke update on public.leads from authenticated;
grant update (estado, nota, historial, borrador, actualizado_panel) on public.leads to authenticated;
revoke insert, delete on public.leads from anon, authenticated;
