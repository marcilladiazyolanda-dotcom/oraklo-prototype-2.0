-- ORAKLO · Paso 9: rangos reales, clasificación y temporadas preparadas
--
-- Reglas de producto confirmadas:
--   * El rango depende únicamente del Prestigio histórico.
--   * El Prestigio histórico y el rango nunca se reinician al cambiar de temporada.
--   * Las temporadas quedan desactivadas hasta una activación administrativa explícita.
--   * Incluso activadas, no empiezan hasta alcanzar el umbral configurable de usuarios.
--   * Umbral inicial: 100 perfiles registrados. Duración inicial: 3 meses.

-- -----------------------------------------------------------------------------
-- 1. Definiciones de rango
-- -----------------------------------------------------------------------------

create table if not exists public.rank_definitions (
  position smallint primary key,
  name text not null unique,
  min_prestige integer not null unique check (min_prestige >= 0),
  description text not null,
  created_at timestamptz not null default now()
);

alter table public.rank_definitions enable row level security;

revoke all on table public.rank_definitions from public, anon, authenticated;
grant all on table public.rank_definitions to postgres, service_role;

insert into public.rank_definitions (
  position,
  name,
  min_prestige,
  description
)
values
  (1, 'Observador', 0, 'Empieza a construir su historial predictivo.'),
  (2, 'Intérprete', 100, 'Detecta señales y empieza a leer el mercado con criterio.'),
  (3, 'Analista', 250, 'Mantiene resultados sólidos y fundamenta sus predicciones.'),
  (4, 'Visionario', 500, 'Anticipa resultados difíciles con una trayectoria destacada.'),
  (5, 'Oráculo', 1000, 'Representa el nivel más alto de reputación predictiva.')
on conflict (position) do update
set
  name = excluded.name,
  min_prestige = excluded.min_prestige,
  description = excluded.description;

create or replace function public.get_rank_for_prestige(prestige_input integer)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select rd.name
  from public.rank_definitions rd
  where rd.min_prestige <= greatest(coalesce(prestige_input, 0), 0)
  order by rd.min_prestige desc
  limit 1;
$function$;

revoke all on function public.get_rank_for_prestige(integer)
  from public, anon, authenticated;
grant execute on function public.get_rank_for_prestige(integer)
  to postgres, service_role;

create or replace function public.sync_profile_rank_from_prestige()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.prestige := greatest(coalesce(new.prestige, 0), 0);
  new.rank := public.get_rank_for_prestige(new.prestige);
  return new;
end;
$function$;

revoke all on function public.sync_profile_rank_from_prestige()
  from public, anon, authenticated;
grant execute on function public.sync_profile_rank_from_prestige()
  to postgres, service_role;

drop trigger if exists sync_profile_rank_from_prestige on public.profiles;
create trigger sync_profile_rank_from_prestige
before insert or update of prestige on public.profiles
for each row
execute function public.sync_profile_rank_from_prestige();

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_prestige_nonnegative_check'
  ) then
    alter table public.profiles
      add constraint profiles_prestige_nonnegative_check
      check (prestige >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_rank_definition_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_rank_definition_fkey
      foreign key (rank)
      references public.rank_definitions(name)
      on update cascade;
  end if;
end
$migration$;

-- Recalcula los perfiles existentes sin alterar su Prestigio.
update public.profiles
set rank = public.get_rank_for_prestige(prestige)
where rank is distinct from public.get_rank_for_prestige(prestige);

create index if not exists profiles_rank_idx
  on public.profiles (rank);

-- El frontend público consume mercados, rangos y clasificaciones mediante RPC.
-- Se retiran privilegios de escritura/DDL heredados que los roles web no usan.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.markets from anon, authenticated;
revoke all on table public.predictions from anon, authenticated;

grant select on table public.profiles to authenticated;
grant select on table public.predictions to authenticated;

drop policy if exists "Profiles are publicly readable" on public.profiles;
drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users can read their own predictions" on public.predictions;
create policy "Users can read their own predictions"
on public.predictions
for select
to authenticated
using ((select auth.uid()) = user_id);

-- Estas funciones preexistentes solo se usan como disparadores internos. No
-- deben poder invocarse como RPC desde el navegador.
do $migration$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    execute 'revoke all on function public.handle_new_user() from public, anon, authenticated';
  end if;

  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$migration$;

-- -----------------------------------------------------------------------------
-- 2. Configuración y ciclo de temporadas
-- -----------------------------------------------------------------------------

create table if not exists public.competition_settings (
  id smallint primary key default 1 check (id = 1),
  seasons_enabled boolean not null default false,
  minimum_registered_users integer not null default 100
    check (minimum_registered_users between 2 and 1000000),
  season_length_months smallint not null default 3
    check (season_length_months between 1 and 12),
  updated_at timestamptz not null default now()
);

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  sequence_number integer not null unique check (sequence_number > 0),
  slug text not null unique,
  name text not null,
  status text not null default 'Preparada'
    check (status in ('Preparada', 'Activa', 'Finalizada')),
  starts_at timestamptz,
  ends_at timestamptz,
  minimum_users_at_start integer,
  activated_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'Preparada' and starts_at is null and ends_at is null)
    or
    (status in ('Activa', 'Finalizada') and starts_at is not null and ends_at is not null)
  ),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

alter table public.competition_settings enable row level security;
alter table public.seasons enable row level security;

revoke all on table public.competition_settings from public, anon, authenticated;
revoke all on table public.seasons from public, anon, authenticated;
grant all on table public.competition_settings to postgres, service_role;
grant all on table public.seasons to postgres, service_role;

create unique index if not exists seasons_one_active_idx
  on public.seasons ((status))
  where status = 'Activa';

create index if not exists seasons_status_sequence_idx
  on public.seasons (status, sequence_number);

create index if not exists predictions_settled_at_user_idx
  on public.predictions (settled_at, user_id)
  where settled_at is not null;

insert into public.competition_settings (
  id,
  seasons_enabled,
  minimum_registered_users,
  season_length_months
)
values (1, false, 100, 3)
on conflict (id) do nothing;

insert into public.seasons (
  sequence_number,
  slug,
  name,
  status
)
values (1, 'temporada-1', 'Temporada 1', 'Preparada')
on conflict (sequence_number) do nothing;

create or replace function public.manage_oraklo_seasons()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  settings_row public.competition_settings%rowtype;
  registered_users_count integer;
  active_season_row public.seasons%rowtype;
  prepared_season_row public.seasons%rowtype;
  next_sequence integer;
begin
  select *
  into settings_row
  from public.competition_settings
  where id = 1
  for update;

  if not found then
    raise exception 'COMPETITION_SETTINGS_NOT_FOUND'
      using errcode = 'P0001';
  end if;

  select count(*)::integer
  into registered_users_count
  from public.profiles;

  -- Una temporada vencida se cierra antes de evaluar el siguiente comienzo.
  update public.seasons
  set
    status = 'Finalizada',
    ended_at = coalesce(ended_at, now()),
    updated_at = now()
  where status = 'Activa'
    and ends_at <= now();

  if not settings_row.seasons_enabled then
    return jsonb_build_object(
      'state', 'Desactivada',
      'registered_users', registered_users_count,
      'minimum_registered_users', settings_row.minimum_registered_users,
      'started', false
    );
  end if;

  select *
  into active_season_row
  from public.seasons
  where status = 'Activa'
  order by sequence_number
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'state', 'Activa',
      'registered_users', registered_users_count,
      'minimum_registered_users', settings_row.minimum_registered_users,
      'season_id', active_season_row.id,
      'season_name', active_season_row.name,
      'started', false
    );
  end if;

  if registered_users_count < settings_row.minimum_registered_users then
    return jsonb_build_object(
      'state', 'Esperando usuarios',
      'registered_users', registered_users_count,
      'minimum_registered_users', settings_row.minimum_registered_users,
      'started', false
    );
  end if;

  select *
  into prepared_season_row
  from public.seasons
  where status = 'Preparada'
  order by sequence_number
  limit 1
  for update;

  if not found then
    select coalesce(max(sequence_number), 0) + 1
    into next_sequence
    from public.seasons;

    insert into public.seasons (
      sequence_number,
      slug,
      name,
      status
    )
    values (
      next_sequence,
      'temporada-' || next_sequence,
      'Temporada ' || next_sequence,
      'Preparada'
    )
    returning * into prepared_season_row;
  end if;

  update public.seasons
  set
    status = 'Activa',
    starts_at = now(),
    ends_at = now() + make_interval(months => settings_row.season_length_months),
    minimum_users_at_start = registered_users_count,
    activated_at = now(),
    updated_at = now()
  where id = prepared_season_row.id
  returning * into active_season_row;

  insert into public.seasons (
    sequence_number,
    slug,
    name,
    status
  )
  values (
    active_season_row.sequence_number + 1,
    'temporada-' || (active_season_row.sequence_number + 1),
    'Temporada ' || (active_season_row.sequence_number + 1),
    'Preparada'
  )
  on conflict (sequence_number) do nothing;

  return jsonb_build_object(
    'state', 'Activa',
    'registered_users', registered_users_count,
    'minimum_registered_users', settings_row.minimum_registered_users,
    'season_id', active_season_row.id,
    'season_name', active_season_row.name,
    'starts_at', active_season_row.starts_at,
    'ends_at', active_season_row.ends_at,
    'started', true
  );
end;
$function$;

revoke all on function public.manage_oraklo_seasons()
  from public, anon, authenticated;
grant execute on function public.manage_oraklo_seasons()
  to postgres, service_role;

drop function if exists public.configure_oraklo_seasons(boolean, integer, smallint);

create or replace function public.configure_oraklo_seasons(
  seasons_enabled_input boolean,
  minimum_registered_users_input integer default null,
  season_length_months_input integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if minimum_registered_users_input is not null
     and minimum_registered_users_input not between 2 and 1000000 then
    raise exception 'INVALID_MINIMUM_REGISTERED_USERS'
      using errcode = '22023';
  end if;

  if season_length_months_input is not null
     and season_length_months_input not between 1 and 12 then
    raise exception 'INVALID_SEASON_LENGTH'
      using errcode = '22023';
  end if;

  update public.competition_settings
  set
    seasons_enabled = coalesce(seasons_enabled_input, false),
    minimum_registered_users = coalesce(
      minimum_registered_users_input,
      minimum_registered_users
    ),
    season_length_months = coalesce(
      season_length_months_input,
      season_length_months
    ),
    updated_at = now()
  where id = 1;

  return public.manage_oraklo_seasons();
end;
$function$;

revoke all on function public.configure_oraklo_seasons(boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.configure_oraklo_seasons(boolean, integer, integer)
  to postgres, service_role;

create or replace function public.maybe_start_oraklo_season_after_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.manage_oraklo_seasons();
  return null;
end;
$function$;

revoke all on function public.maybe_start_oraklo_season_after_signup()
  from public, anon, authenticated;
grant execute on function public.maybe_start_oraklo_season_after_signup()
  to postgres, service_role;

drop trigger if exists maybe_start_oraklo_season_after_signup on public.profiles;
create trigger maybe_start_oraklo_season_after_signup
after insert on public.profiles
for each statement
execute function public.maybe_start_oraklo_season_after_signup();

-- La comprobación periódica es inerte mientras seasons_enabled sea false.
do $migration$
begin
  if exists (
    select 1
    from pg_extension
    where extname = 'pg_cron'
  ) and not exists (
    select 1
    from cron.job
    where jobname = 'oraklo_manage_seasons'
  ) then
    perform cron.schedule(
      'oraklo_manage_seasons',
      '*/5 * * * *',
      'select public.manage_oraklo_seasons();'
    );
  end if;
end
$migration$;

-- -----------------------------------------------------------------------------
-- 3. RPC públicas de rangos y clasificación
-- -----------------------------------------------------------------------------

create or replace function public.get_public_rank_ladder()
returns table (
  "position" smallint,
  name text,
  min_prestige integer,
  description text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    rd.position,
    rd.name,
    rd.min_prestige,
    rd.description
  from public.rank_definitions rd
  order by rd.position;
$function$;

revoke all on function public.get_public_rank_ladder()
  from public, anon, authenticated;
grant execute on function public.get_public_rank_ladder()
  to anon, authenticated;

create or replace function public.get_public_global_leaderboard(
  limit_count integer default 100
)
returns table (
  "position" bigint,
  id uuid,
  username text,
  prestige integer,
  rank text,
  best_category text,
  resolved_predictions integer,
  correct_predictions integer,
  accuracy numeric,
  next_rank text,
  prestige_to_next_rank integer
)
language sql
stable
security definer
set search_path = ''
as $function$
  with prediction_stats as (
    select
      pr.user_id,
      count(*) filter (where pr.is_correct is not null)::integer
        as resolved_predictions,
      count(*) filter (where pr.is_correct is true)::integer
        as correct_predictions
    from public.predictions pr
    where pr.settled_at is not null
    group by pr.user_id
  ),
  candidates as (
    select
      p.id,
      p.username,
      p.prestige,
      p.rank,
      p.best_category,
      p.created_at,
      coalesce(ps.resolved_predictions, 0) as resolved_predictions,
      coalesce(ps.correct_predictions, 0) as correct_predictions,
      case
        when coalesce(ps.resolved_predictions, 0) = 0 then 0::numeric
        else round(
          ps.correct_predictions::numeric * 100
            / ps.resolved_predictions::numeric,
          1
        )
      end as accuracy
    from public.profiles p
    left join prediction_stats ps on ps.user_id = p.id
    where p.prestige > 0
       or coalesce(ps.resolved_predictions, 0) > 0
  ),
  ranked as (
    select
      row_number() over (
        order by
          c.prestige desc,
          c.correct_predictions desc,
          c.accuracy desc,
          c.created_at,
          c.id
      ) as position,
      c.*
    from candidates c
  )
  select
    r.position,
    r.id,
    r.username,
    r.prestige,
    r.rank,
    r.best_category,
    r.resolved_predictions,
    r.correct_predictions,
    r.accuracy,
    next_rank.name as next_rank,
    case
      when next_rank.min_prestige is null then 0
      else greatest(next_rank.min_prestige - r.prestige, 0)
    end::integer as prestige_to_next_rank
  from ranked r
  left join lateral (
    select rd.name, rd.min_prestige
    from public.rank_definitions rd
    where rd.min_prestige > r.prestige
    order by rd.min_prestige
    limit 1
  ) next_rank on true
  order by r.position
  limit greatest(1, least(coalesce(limit_count, 100), 100));
$function$;

revoke all on function public.get_public_global_leaderboard(integer)
  from public, anon, authenticated;
grant execute on function public.get_public_global_leaderboard(integer)
  to anon, authenticated;

create or replace function public.get_public_competition_status()
returns table (
  seasons_enabled boolean,
  state text,
  minimum_registered_users integer,
  registered_users integer,
  users_remaining integer,
  threshold_reached boolean,
  season_length_months smallint,
  season_id uuid,
  season_name text,
  season_status text,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  with settings as (
    select *
    from public.competition_settings
    where id = 1
  ),
  user_count as (
    select count(*)::integer as total
    from public.profiles
  ),
  selected_season as (
    select s.*
    from public.seasons s
    order by
      case s.status
        when 'Activa' then 1
        when 'Preparada' then 2
        else 3
      end,
      s.sequence_number desc
    limit 1
  )
  select
    cs.seasons_enabled,
    case
      when ss.status = 'Activa' then 'Activa'
      when not cs.seasons_enabled then 'Desactivada'
      when uc.total < cs.minimum_registered_users then 'Esperando usuarios'
      else 'Preparada'
    end as state,
    cs.minimum_registered_users,
    uc.total as registered_users,
    greatest(cs.minimum_registered_users - uc.total, 0)::integer
      as users_remaining,
    uc.total >= cs.minimum_registered_users as threshold_reached,
    cs.season_length_months,
    ss.id as season_id,
    ss.name as season_name,
    ss.status as season_status,
    ss.starts_at,
    ss.ends_at
  from settings cs
  cross join user_count uc
  left join selected_season ss on true;
$function$;

revoke all on function public.get_public_competition_status()
  from public, anon, authenticated;
grant execute on function public.get_public_competition_status()
  to anon, authenticated;

create or replace function public.get_public_season_leaderboard(
  limit_count integer default 100
)
returns table (
  season_id uuid,
  season_name text,
  "position" bigint,
  id uuid,
  username text,
  season_prestige integer,
  lifetime_prestige integer,
  rank text,
  best_category text,
  resolved_predictions integer,
  correct_predictions integer,
  accuracy numeric
)
language sql
stable
security definer
set search_path = ''
as $function$
  with active_season as (
    select s.*
    from public.seasons s
    where s.status = 'Activa'
      and s.starts_at <= now()
      and s.ends_at > now()
    order by s.sequence_number
    limit 1
  ),
  season_stats as (
    select
      pr.user_id,
      greatest(coalesce(sum(pr.prestige_change), 0), 0)::integer
        as season_prestige,
      count(*) filter (where pr.is_correct is not null)::integer
        as resolved_predictions,
      count(*) filter (where pr.is_correct is true)::integer
        as correct_predictions,
      min(pr.settled_at) as first_settled_at
    from public.predictions pr
    cross join active_season s
    where pr.settled_at >= s.starts_at
      and pr.settled_at < s.ends_at
      and pr.is_correct is not null
    group by pr.user_id
  ),
  candidates as (
    select
      s.id as season_id,
      s.name as season_name,
      p.id,
      p.username,
      ss.season_prestige,
      p.prestige as lifetime_prestige,
      p.rank,
      p.best_category,
      ss.resolved_predictions,
      ss.correct_predictions,
      case
        when ss.resolved_predictions = 0 then 0::numeric
        else round(
          ss.correct_predictions::numeric * 100
            / ss.resolved_predictions::numeric,
          1
        )
      end as accuracy,
      ss.first_settled_at,
      p.created_at
    from active_season s
    join season_stats ss on true
    join public.profiles p on p.id = ss.user_id
  ),
  ranked as (
    select
      row_number() over (
        order by
          c.season_prestige desc,
          c.correct_predictions desc,
          c.accuracy desc,
          c.first_settled_at,
          c.created_at,
          c.id
      ) as position,
      c.*
    from candidates c
  )
  select
    r.season_id,
    r.season_name,
    r.position,
    r.id,
    r.username,
    r.season_prestige,
    r.lifetime_prestige,
    r.rank,
    r.best_category,
    r.resolved_predictions,
    r.correct_predictions,
    r.accuracy
  from ranked r
  order by r.position
  limit greatest(1, least(coalesce(limit_count, 100), 100));
$function$;

revoke all on function public.get_public_season_leaderboard(integer)
  from public, anon, authenticated;
grant execute on function public.get_public_season_leaderboard(integer)
  to anon, authenticated;

create or replace function public.get_my_competition_summary()
returns table (
  user_id uuid,
  global_position bigint,
  season_position bigint,
  prestige integer,
  season_prestige integer,
  rank text,
  current_rank_min integer,
  next_rank text,
  next_rank_min integer,
  prestige_to_next_rank integer,
  season_name text,
  season_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED'
      using errcode = '28000';
  end if;

  return query
  with all_time_stats as (
    select
      pr.user_id,
      count(*) filter (where pr.is_correct is not null)::integer
        as resolved_predictions,
      count(*) filter (where pr.is_correct is true)::integer
        as correct_predictions
    from public.predictions pr
    where pr.settled_at is not null
    group by pr.user_id
  ),
  global_candidates as (
    select
      p.id,
      p.prestige,
      p.created_at,
      coalesce(ats.resolved_predictions, 0) as resolved_predictions,
      coalesce(ats.correct_predictions, 0) as correct_predictions,
      case
        when coalesce(ats.resolved_predictions, 0) = 0 then 0::numeric
        else round(
          ats.correct_predictions::numeric * 100
            / ats.resolved_predictions::numeric,
          1
        )
      end as accuracy
    from public.profiles p
    left join all_time_stats ats on ats.user_id = p.id
    where p.prestige > 0
       or coalesce(ats.resolved_predictions, 0) > 0
  ),
  global_ranked as (
    select
      gc.id,
      row_number() over (
        order by
          gc.prestige desc,
          gc.correct_predictions desc,
          gc.accuracy desc,
          gc.created_at,
          gc.id
      ) as position
    from global_candidates gc
  ),
  active_season as (
    select s.*
    from public.seasons s
    where s.status = 'Activa'
      and s.starts_at <= now()
      and s.ends_at > now()
    order by s.sequence_number
    limit 1
  ),
  season_stats as (
    select
      pr.user_id,
      greatest(coalesce(sum(pr.prestige_change), 0), 0)::integer
        as season_prestige,
      count(*) filter (where pr.is_correct is not null)::integer
        as resolved_predictions,
      count(*) filter (where pr.is_correct is true)::integer
        as correct_predictions,
      min(pr.settled_at) as first_settled_at
    from public.predictions pr
    cross join active_season s
    where pr.settled_at >= s.starts_at
      and pr.settled_at < s.ends_at
      and pr.is_correct is not null
    group by pr.user_id
  ),
  season_candidates as (
    select
      ss.user_id,
      ss.season_prestige,
      ss.correct_predictions,
      case
        when ss.resolved_predictions = 0 then 0::numeric
        else round(
          ss.correct_predictions::numeric * 100
            / ss.resolved_predictions::numeric,
          1
        )
      end as accuracy,
      ss.first_settled_at
    from season_stats ss
  ),
  season_ranked as (
    select
      sc.user_id,
      sc.season_prestige,
      row_number() over (
        order by
          sc.season_prestige desc,
          sc.correct_predictions desc,
          sc.accuracy desc,
          sc.first_settled_at,
          sc.user_id
      ) as position
    from season_candidates sc
  ),
  competition as (
    select *
    from public.get_public_competition_status()
  )
  select
    p.id as user_id,
    gr.position as global_position,
    sr.position as season_position,
    p.prestige,
    coalesce(sr.season_prestige, 0) as season_prestige,
    p.rank,
    current_rank.min_prestige as current_rank_min,
    next_rank.name as next_rank,
    next_rank.min_prestige as next_rank_min,
    case
      when next_rank.min_prestige is null then 0
      else greatest(next_rank.min_prestige - p.prestige, 0)
    end::integer as prestige_to_next_rank,
    competition.season_name,
    competition.state as season_state
  from public.profiles p
  left join global_ranked gr on gr.id = p.id
  left join season_ranked sr on sr.user_id = p.id
  left join public.rank_definitions current_rank
    on current_rank.name = p.rank
  left join lateral (
    select rd.name, rd.min_prestige
    from public.rank_definitions rd
    where rd.min_prestige > p.prestige
    order by rd.min_prestige
    limit 1
  ) next_rank on true
  cross join competition
  where p.id = current_user_id;
end;
$function$;

revoke all on function public.get_my_competition_summary()
  from public, anon, authenticated;
grant execute on function public.get_my_competition_summary()
  to authenticated;

comment on table public.rank_definitions is
  'Escalera oficial de rangos de Oraklo basada en Prestigio histórico.';
comment on table public.competition_settings is
  'Configuración privada de activación y duración de temporadas.';
comment on table public.seasons is
  'Temporadas competitivas. Permanecen preparadas hasta activación explícita.';
comment on function public.configure_oraklo_seasons(boolean, integer, integer) is
  'Activa o desactiva temporadas y ajusta sus umbrales. Solo backend de servicio.';
