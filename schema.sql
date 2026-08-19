-- =============================================================================
-- CEDI OS — esquema de base de datos para Supabase
-- Cómo usarlo: Supabase → tu proyecto → SQL Editor → New query → pega todo
-- este archivo → Run. Se puede correr una sola vez.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- TABLAS
-- -----------------------------------------------------------------------------

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  bay text not null,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  name text not null default 'Sin nombre',
  role text not null default 'usuario' check (role in ('admin','usuario')),
  team_id uuid references teams(id) on delete set null,
  puesto text default 'Sin definir',
  jefe text default '—',
  funciones text[] default '{}',
  permisos jsonb not null default '{"editarKPIs":false,"editarOKRs":false,"gestionarActividades":false,"verBSC":false}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists kpis (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  name text not null,
  meta numeric not null,
  actual numeric not null,
  unidad text default '',
  perspectiva text not null check (perspectiva in ('Financiera','Clientes','Procesos','Aprendizaje')),
  mejor_mayor boolean not null default true,
  updated_at timestamptz default now()
);

create table if not exists kpi_historial (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid references kpis(id) on delete cascade,
  fecha date not null default current_date,
  valor numeric not null
);

create table if not exists okrs_equipo (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  objetivo text not null,
  created_at timestamptz default now()
);

create table if not exists okr_krs (
  id uuid primary key default gen_random_uuid(),
  okr_id uuid references okrs_equipo(id) on delete cascade,
  kr text not null,
  meta numeric not null,
  actual numeric not null default 0,
  unidad text default '',
  mejor_mayor boolean not null default true
);

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete set null,
  titulo text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','en_progreso','completada')),
  asignado_a uuid references profiles(id) on delete set null,
  fecha date,
  created_at timestamptz default now()
);

create table if not exists activity_comentarios (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid references activities(id) on delete cascade,
  autor_id uuid references profiles(id) on delete set null,
  texto text not null,
  fecha date default current_date
);

-- -----------------------------------------------------------------------------
-- FUNCIONES DE APOYO
-- -----------------------------------------------------------------------------

-- Devuelve true si quien hace la petición es administrador. security definer
-- para que se pueda usar dentro de las políticas de "profiles" sin recursión.
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

create or replace function my_team_id()
returns uuid
language sql
security definer
set search_path = public
as $$
  select team_id from profiles where id = auth.uid();
$$;

create or replace function my_permiso(clave text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select (permisos->>clave)::boolean from profiles where id = auth.uid()), false);
$$;

-- Crea automáticamente un perfil (rol "usuario" por defecto) cada vez que se
-- crea una cuenta nueva en Authentication → Users desde el panel de Supabase.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, name)
  values (new.id, split_part(new.email, '@', 1), split_part(new.email, '@', 1));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Registra automáticamente el historial cada vez que cambia el valor real de un KPI.
create or replace function log_kpi_historial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.actual is distinct from old.actual then
    insert into kpi_historial (kpi_id, fecha, valor) values (new.id, current_date, new.actual);
  end if;
  return new;
end;
$$;

drop trigger if exists on_kpi_actual_change on kpis;
create trigger on_kpi_actual_change
  after update on kpis
  for each row execute function log_kpi_historial();

-- -----------------------------------------------------------------------------
-- SEGURIDAD A NIVEL DE FILA (RLS)
-- -----------------------------------------------------------------------------

alter table teams enable row level security;
alter table profiles enable row level security;
alter table kpis enable row level security;
alter table kpi_historial enable row level security;
alter table okrs_equipo enable row level security;
alter table okr_krs enable row level security;
alter table activities enable row level security;
alter table activity_comentarios enable row level security;

-- TEAMS: todos los que iniciaron sesión pueden ver las áreas; solo el admin las modifica.
drop policy if exists "teams_select" on teams;
drop policy if exists "teams_write" on teams;
create policy "teams_select" on teams for select using (auth.role() = 'authenticated');
create policy "teams_write" on teams for all using (is_admin()) with check (is_admin());

-- PROFILES: todos pueden ver los perfiles (para asignar tareas, ver nombres);
-- solo el admin los edita o los borra. La creación la hace el trigger.
drop policy if exists "profiles_select" on profiles;
drop policy if exists "profiles_update" on profiles;
drop policy if exists "profiles_delete" on profiles;
create policy "profiles_select" on profiles for select using (auth.role() = 'authenticated');
create policy "profiles_update" on profiles for update using (is_admin());
create policy "profiles_delete" on profiles for delete using (is_admin());

-- KPIS: cada usuario ve los de su propia área + los corporativos; el admin ve todo.
-- Editar el valor real: admin, o quien tenga el permiso "editarKPIs" en su propia área.
drop policy if exists "kpis_select" on kpis;
drop policy if exists "kpis_update" on kpis;
drop policy if exists "kpis_write_admin" on kpis;
drop policy if exists "kpis_delete_admin" on kpis;
create policy "kpis_select" on kpis for select using (
  is_admin() or team_id is null or team_id = my_team_id()
);
create policy "kpis_update" on kpis for update using (
  is_admin() or (team_id = my_team_id() and my_permiso('editarKPIs'))
);
create policy "kpis_write_admin" on kpis for insert with check (is_admin());
create policy "kpis_delete_admin" on kpis for delete using (is_admin());

-- HISTORIAL: se ve si se puede ver el KPI correspondiente. Se inserta solo por el trigger.
drop policy if exists "kpi_historial_select" on kpi_historial;
create policy "kpi_historial_select" on kpi_historial for select using (
  exists (
    select 1 from kpis k where k.id = kpi_historial.kpi_id
    and (is_admin() or k.team_id is null or k.team_id = my_team_id())
  )
);

-- OKRS DE EQUIPO: visibles para el admin y para los miembros de esa área.
drop policy if exists "okrs_select" on okrs_equipo;
drop policy if exists "okrs_insert" on okrs_equipo;
drop policy if exists "okrs_delete" on okrs_equipo;
create policy "okrs_select" on okrs_equipo for select using (
  is_admin() or team_id = my_team_id()
);
create policy "okrs_insert" on okrs_equipo for insert with check (
  is_admin() or (team_id = my_team_id() and my_permiso('editarOKRs'))
);
create policy "okrs_delete" on okrs_equipo for delete using (is_admin());

drop policy if exists "okr_krs_select" on okr_krs;
drop policy if exists "okr_krs_update" on okr_krs;
drop policy if exists "okr_krs_insert" on okr_krs;
create policy "okr_krs_select" on okr_krs for select using (
  exists (
    select 1 from okrs_equipo o where o.id = okr_krs.okr_id
    and (is_admin() or o.team_id = my_team_id())
  )
);
create policy "okr_krs_update" on okr_krs for update using (
  exists (
    select 1 from okrs_equipo o where o.id = okr_krs.okr_id
    and (is_admin() or (o.team_id = my_team_id() and my_permiso('editarOKRs')))
  )
);
create policy "okr_krs_insert" on okr_krs for insert with check (
  exists (
    select 1 from okrs_equipo o where o.id = okr_krs.okr_id
    and (is_admin() or (o.team_id = my_team_id() and my_permiso('editarOKRs')))
  )
);

-- ACTIVIDADES: el admin ve todo; quien tenga "gestionarActividades" ve toda su
-- área; cualquier otro usuario solo ve lo que le fue asignado a él.
drop policy if exists "activities_select" on activities;
drop policy if exists "activities_insert" on activities;
drop policy if exists "activities_update" on activities;
drop policy if exists "activities_delete" on activities;
create policy "activities_select" on activities for select using (
  is_admin()
  or asignado_a = auth.uid()
  or (my_permiso('gestionarActividades') and team_id = my_team_id())
);
create policy "activities_insert" on activities for insert with check (
  is_admin() or (my_permiso('gestionarActividades') and team_id = my_team_id())
);
create policy "activities_update" on activities for update using (
  is_admin()
  or asignado_a = auth.uid()
  or (my_permiso('gestionarActividades') and team_id = my_team_id())
);
create policy "activities_delete" on activities for delete using (
  is_admin() or (my_permiso('gestionarActividades') and team_id = my_team_id())
);

-- COMENTARIOS: visibles/creables por quien puede ver la actividad a la que pertenecen.
drop policy if exists "comentarios_select" on activity_comentarios;
drop policy if exists "comentarios_insert" on activity_comentarios;
create policy "comentarios_select" on activity_comentarios for select using (
  exists (
    select 1 from activities a where a.id = activity_comentarios.activity_id
    and (is_admin() or a.asignado_a = auth.uid() or (my_permiso('gestionarActividades') and a.team_id = my_team_id()))
  )
);
create policy "comentarios_insert" on activity_comentarios for insert with check (
  exists (
    select 1 from activities a where a.id = activity_comentarios.activity_id
    and (is_admin() or a.asignado_a = auth.uid() or (my_permiso('gestionarActividades') and a.team_id = my_team_id()))
  )
);

-- -----------------------------------------------------------------------------
-- DATOS DE EJEMPLO (áreas, KPI, OKR, actividades) — solo se insertan si la
-- tabla "teams" está vacía, para que este script se pueda volver a correr sin
-- duplicar información. Los usuarios NO se crean aquí; se crean desde
-- Authentication → Users en el panel de Supabase.
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from teams) then
    insert into teams (bay, name) values ('01', 'Ventas'), ('02', 'Finanzas');

    insert into kpis (team_id, name, meta, actual, unidad, perspectiva, mejor_mayor)
    select id, 'Empresas nuevas activadas', 40, 27, ' empresas', 'Clientes', true from teams where name = 'Ventas'
    union all
    select id, 'MRR generado', 150000, 98000, ' MXN', 'Financiera', true from teams where name = 'Ventas'
    union all
    select id, 'Tasa de conversión de demo a contrato', 30, 22, '%', 'Procesos', true from teams where name = 'Ventas'
    union all
    select id, 'Cartera vencida (tarjetas corporativas)', 5, 7.5, '%', 'Financiera', false from teams where name = 'Finanzas'
    union all
    select id, 'Cierre contable a tiempo', 1, 1, ' mes', 'Procesos', true from teams where name = 'Finanzas'
    union all
    select id, 'Costo por transacción procesada (POS/dispersión)', 3.5, 4.1, ' MXN', 'Financiera', false from teams where name = 'Finanzas';

    insert into kpis (team_id, name, meta, actual, unidad, perspectiva, mejor_mayor) values
    (null, 'Empresas activas en la plataforma', 300, 245, ' empresas', 'Clientes', true),
    (null, 'NPS de clientes', 60, 52, ' pts', 'Clientes', true),
    (null, 'Uptime de la plataforma', 99.9, 99.6, '%', 'Procesos', true),
    (null, 'Horas de capacitación por colaborador', 8, 5, ' h/mes', 'Aprendizaje', true);

    insert into okrs_equipo (team_id, objetivo)
    select id, 'Acelerar la activación de nuevas empresas en Cedi' from teams where name = 'Ventas';
    insert into okr_krs (okr_id, kr, meta, actual, unidad, mejor_mayor)
    select id, 'Empresas nuevas activadas', 40, 27, ' empresas', true from okrs_equipo where objetivo = 'Acelerar la activación de nuevas empresas en Cedi'
    union all
    select id, 'MRR generado', 150000, 98000, ' MXN', true from okrs_equipo where objetivo = 'Acelerar la activación de nuevas empresas en Cedi';

    insert into okrs_equipo (team_id, objetivo)
    select id, 'Mantener la salud financiera y regulatoria del periodo' from teams where name = 'Finanzas';
    insert into okr_krs (okr_id, kr, meta, actual, unidad, mejor_mayor)
    select id, 'Cartera vencida (tarjetas corporativas)', 5, 7.5, '%', false from okrs_equipo where objetivo = 'Mantener la salud financiera y regulatoria del periodo'
    union all
    select id, 'Cierre contable a tiempo', 1, 1, ' mes', true from okrs_equipo where objetivo = 'Mantener la salud financiera y regulatoria del periodo';
  end if;
end $$;

-- Las actividades se dejan vacías: cuando el admin cree a los usuarios reales
-- (Ventas / Finanzas) desde Authentication → Users, podrá asignarles tareas
-- directamente desde la app.
