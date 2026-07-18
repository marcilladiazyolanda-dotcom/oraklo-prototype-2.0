-- Oraklo · Paso 11: MVP social y comunidad
--
-- Alcance:
--   * Comentarios y respuestas de un nivel en mercados.
--   * Seguimiento privado de perfiles y silencios personales.
--   * Feed cronologico global y de cuentas seguidas.
--   * Reaccion positiva "Buena lectura".
--   * Reportes, moderacion humana, contenido oculto y restricciones temporales.
--
-- Privacidad:
--   * Ninguna funcion social publica Karma disponible ni predicciones activas.
--   * Las relaciones completas de seguimiento y silencio son privadas.
--   * Las tablas no se exponen directamente: el acceso se realiza mediante RPC
--     con listas cerradas de campos y comprobaciones de identidad.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. Tablas sociales
-- -----------------------------------------------------------------------------

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  market_id text not null references public.markets(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  parent_id uuid references public.community_comments(id) on delete cascade,
  body text not null,
  is_spoiler boolean not null default false,
  status text not null default 'Visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  moderated_at timestamptz,
  moderated_by uuid references auth.users(id) on delete set null,
  moderation_reason text,
  constraint community_comments_body_length_check
    check (char_length(btrim(body)) between 1 and 500),
  constraint community_comments_status_check
    check (status in ('Visible', 'Oculto', 'Eliminado')),
  constraint community_comments_parent_not_self_check
    check (parent_id is null or parent_id <> id),
  constraint community_comments_moderation_reason_length_check
    check (moderation_reason is null or char_length(moderation_reason) <= 1000)
);

comment on table public.community_comments is
  'Comentarios publicos de mercados. El borrado y la moderacion son logicos para conservar auditoria.';

create table if not exists public.community_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followed_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint community_follows_not_self_check check (follower_id <> followed_id)
);

comment on table public.community_follows is
  'Relaciones privadas de seguimiento. Solo se publican contadores agregados.';

create table if not exists public.community_mutes (
  muter_id uuid not null references auth.users(id) on delete cascade,
  muted_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint community_mutes_not_self_check check (muter_id <> muted_id)
);

comment on table public.community_mutes is
  'Silencios privados usados para ocultar contenido del feed y los debates.';

create table if not exists public.community_comment_reactions (
  comment_id uuid not null references public.community_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction_type text not null default 'Buena lectura',
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id),
  constraint community_comment_reactions_type_check
    check (reaction_type = 'Buena lectura')
);

create table if not exists public.community_prediction_reactions (
  prediction_id uuid not null references public.predictions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction_type text not null default 'Buena lectura',
  created_at timestamptz not null default now(),
  primary key (prediction_id, user_id),
  constraint community_prediction_reactions_type_check
    check (reaction_type = 'Buena lectura')
);

create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  detail text,
  target_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'Pendiente',
  decision text,
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  constraint community_reports_target_type_check
    check (target_type in ('comment', 'profile')),
  constraint community_reports_reason_check
    check (reason in ('spam', 'harassment', 'hate', 'illegal', 'impersonation', 'other')),
  constraint community_reports_detail_length_check
    check (detail is null or char_length(detail) <= 1000),
  constraint community_reports_status_check
    check (status in ('Pendiente', 'Descartado', 'Actuado')),
  constraint community_reports_decision_check
    check (decision is null or decision in ('dismiss', 'hide', 'restrict', 'hide_and_restrict')),
  constraint community_reports_note_length_check
    check (review_note is null or char_length(review_note) <= 1000),
  constraint community_reports_snapshot_object_check
    check (jsonb_typeof(target_snapshot) = 'object')
);

comment on table public.community_reports is
  'Reportes privados de comentarios y perfiles. La identidad del informante nunca se publica.';

create table if not exists public.community_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  restricted_until timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  lifted_at timestamptz,
  lifted_by uuid references auth.users(id) on delete set null,
  lift_reason text,
  constraint community_restrictions_reason_length_check
    check (char_length(btrim(reason)) between 1 and 1000),
  constraint community_restrictions_future_check
    check (restricted_until > created_at),
  constraint community_restrictions_lift_reason_length_check
    check (lift_reason is null or char_length(lift_reason) <= 1000)
);

create table if not exists public.community_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id) on delete set null,
  action_type text not null,
  target_type text not null,
  target_id uuid not null,
  report_id uuid references public.community_reports(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint community_moderation_actions_target_check
    check (target_type in ('comment', 'profile', 'restriction')),
  constraint community_moderation_actions_type_check
    check (action_type in ('dismiss', 'hide', 'restrict', 'hide_and_restrict', 'restore', 'lift_restriction')),
  constraint community_moderation_actions_reason_length_check
    check (reason is null or char_length(reason) <= 1000),
  constraint community_moderation_actions_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.community_moderation_actions is
  'Registro privado e inmutable de decisiones humanas de moderacion.';

-- -----------------------------------------------------------------------------
-- 2. Indices para claves foraneas, RLS y paginacion por cursor
-- -----------------------------------------------------------------------------

create index if not exists community_comments_market_parent_created_idx
  on public.community_comments (market_id, parent_id, created_at desc, id desc);

create index if not exists community_comments_author_created_idx
  on public.community_comments (author_id, created_at desc);

create index if not exists community_comments_visible_feed_idx
  on public.community_comments (created_at desc, id desc)
  where status = 'Visible';

create index if not exists predictions_public_community_feed_idx
  on public.predictions (settled_at desc, id desc)
  include (user_id, market_id, option_selected, resolution_result, is_correct, prestige_change)
  where settled_at is not null;

create index if not exists community_comments_parent_idx
  on public.community_comments (parent_id)
  where parent_id is not null;

create index if not exists community_comments_moderated_by_idx
  on public.community_comments (moderated_by)
  where moderated_by is not null;

create index if not exists community_follows_followed_idx
  on public.community_follows (followed_id, created_at desc);

create index if not exists community_follows_follower_created_idx
  on public.community_follows (follower_id, created_at desc, followed_id desc);

create index if not exists community_mutes_muted_idx
  on public.community_mutes (muted_id);

create index if not exists community_comment_reactions_user_idx
  on public.community_comment_reactions (user_id);

create index if not exists community_prediction_reactions_user_idx
  on public.community_prediction_reactions (user_id);

create unique index if not exists community_reports_one_pending_target_idx
  on public.community_reports (reporter_id, target_type, target_id)
  where status = 'Pendiente' and reporter_id is not null;

create index if not exists community_reports_status_created_idx
  on public.community_reports (status, created_at desc, id desc);

create index if not exists community_reports_reporter_idx
  on public.community_reports (reporter_id, created_at desc)
  where reporter_id is not null;

create index if not exists community_reports_target_idx
  on public.community_reports (target_type, target_id);

create index if not exists community_reports_reviewed_by_idx
  on public.community_reports (reviewed_by)
  where reviewed_by is not null;

create unique index if not exists community_restrictions_one_active_user_idx
  on public.community_restrictions (user_id)
  where active = true;

create index if not exists community_restrictions_user_idx
  on public.community_restrictions (user_id);

create index if not exists community_restrictions_created_by_idx
  on public.community_restrictions (created_by)
  where created_by is not null;

create index if not exists community_restrictions_lifted_by_idx
  on public.community_restrictions (lifted_by)
  where lifted_by is not null;

create index if not exists community_moderation_actions_target_idx
  on public.community_moderation_actions (target_type, target_id, created_at desc);

create index if not exists community_moderation_actions_admin_idx
  on public.community_moderation_actions (admin_id, created_at desc);

create index if not exists community_moderation_actions_report_idx
  on public.community_moderation_actions (report_id)
  where report_id is not null;

-- -----------------------------------------------------------------------------
-- 3. RLS y acceso directo minimo
-- -----------------------------------------------------------------------------

alter table public.community_comments enable row level security;
alter table public.community_follows enable row level security;
alter table public.community_mutes enable row level security;
alter table public.community_comment_reactions enable row level security;
alter table public.community_prediction_reactions enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_restrictions enable row level security;
alter table public.community_moderation_actions enable row level security;

-- No se conceden permisos directos a anon/authenticated. Las RPC con campos
-- cerrados son la unica API publica; RLS queda como defensa adicional.
revoke all on table public.community_comments from anon, authenticated;
revoke all on table public.community_follows from anon, authenticated;
revoke all on table public.community_mutes from anon, authenticated;
revoke all on table public.community_comment_reactions from anon, authenticated;
revoke all on table public.community_prediction_reactions from anon, authenticated;
revoke all on table public.community_reports from anon, authenticated;
revoke all on table public.community_restrictions from anon, authenticated;
revoke all on table public.community_moderation_actions from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Helpers privados de autorizacion y sincronizacion
-- -----------------------------------------------------------------------------

create or replace function private.is_oraklo_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = (select auth.uid())
      and coalesce(u.raw_app_meta_data ->> 'oraklo_admin', 'false') = 'true'
  );
$$;

revoke all on function private.is_oraklo_admin() from public, anon, authenticated;

create or replace function private.is_community_restricted(user_id_input uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.community_restrictions r
    where r.user_id = user_id_input
      and r.active = true
      and r.restricted_until > now()
  );
$$;

revoke all on function private.is_community_restricted(uuid) from public, anon, authenticated;

create or replace function private.validate_community_comment_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_market_id text;
  grandparent_id uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select parent.market_id, parent.parent_id
  into parent_market_id, grandparent_id
  from public.community_comments parent
  where parent.id = new.parent_id;

  if not found or parent_market_id <> new.market_id or grandparent_id is not null then
    raise exception using errcode = '23514', message = 'INVALID_COMMENT_PARENT';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_community_comment_parent()
  from public, anon, authenticated;

drop trigger if exists validate_community_comment_parent on public.community_comments;
create trigger validate_community_comment_parent
before insert or update of parent_id, market_id
on public.community_comments
for each row execute function private.validate_community_comment_parent();

create or replace function private.refresh_market_comment_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_market_id text;
  previous_market_id text;
begin
  target_market_id := case when tg_op = 'DELETE' then old.market_id else new.market_id end;
  previous_market_id := case when tg_op = 'UPDATE' then old.market_id else null end;

  update public.markets m
  set comments_count = (
    select count(*)::integer
    from public.community_comments c
    where c.market_id = target_market_id
      and c.status = 'Visible'
  )
  where m.id = target_market_id;

  if previous_market_id is not null and previous_market_id <> target_market_id then
    update public.markets m
    set comments_count = (
      select count(*)::integer
      from public.community_comments c
      where c.market_id = previous_market_id
        and c.status = 'Visible'
    )
    where m.id = previous_market_id;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Feed cronologico publico
-- -----------------------------------------------------------------------------

create or replace function public.get_public_community_feed(
  feed_mode_input text default 'community',
  before_event_at_input timestamptz default null,
  before_event_key_input text default null,
  limit_count integer default 13
)
returns table (
  event_type text,
  event_id uuid,
  event_key text,
  event_at timestamptz,
  author_id uuid,
  username text,
  avatar_key text,
  profile_theme text,
  rank text,
  market_id text,
  market_question text,
  market_category text,
  comment_body text,
  comment_is_spoiler boolean,
  comment_is_reply boolean,
  prediction_option text,
  prediction_result text,
  prediction_is_correct boolean,
  prediction_prestige_change integer,
  reaction_count bigint,
  viewer_reacted boolean,
  viewer_can_react boolean,
  viewer_has_open_report boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  normalized_mode text := lower(coalesce(feed_mode_input, 'community'));
begin
  if normalized_mode not in ('community', 'following') then
    raise exception using errcode = '22023', message = 'INVALID_FEED_MODE';
  end if;

  if normalized_mode = 'following' and caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  return query
  with events as (
    select
      'comment'::text as event_type,
      comment.id as event_id,
      ('comment:' || comment.id::text)::text as event_key,
      comment.created_at as event_at,
      comment.author_id,
      profile.username,
      coalesce(profile.avatar_key, 'oracle')::text as avatar_key,
      coalesce(profile.profile_theme, 'aurora')::text as profile_theme,
      coalesce(profile.rank, 'Observador')::text as rank,
      market.id as market_id,
      market.question as market_question,
      market.category as market_category,
      comment.body as comment_body,
      comment.is_spoiler as comment_is_spoiler,
      (comment.parent_id is not null) as comment_is_reply,
      null::text as prediction_option,
      null::text as prediction_result,
      null::boolean as prediction_is_correct,
      null::integer as prediction_prestige_change,
      (
        select count(*)
        from public.community_comment_reactions reaction
        where reaction.comment_id = comment.id
      ) as reaction_count,
      exists (
        select 1
        from public.community_comment_reactions reaction
        where reaction.comment_id = comment.id
          and reaction.user_id = caller_id
      ) as viewer_reacted,
      caller_id is not null
        and comment.author_id <> caller_id
        as viewer_can_react,
      exists (
        select 1
        from public.community_reports report
        where report.reporter_id = caller_id
          and report.target_type = 'comment'
          and report.target_id = comment.id
          and report.status = 'Pendiente'
      ) as viewer_has_open_report
    from public.community_comments comment
    join public.profiles profile on profile.id = comment.author_id
    join public.markets market on market.id = comment.market_id
    where comment.status = 'Visible'
      and (
        before_event_at_input is null
        or (comment.created_at, 'comment:' || comment.id::text)
          < (before_event_at_input, before_event_key_input)
      )
      and (
        normalized_mode = 'community'
        or exists (
          select 1
          from public.community_follows follow_row
          where follow_row.follower_id = caller_id
            and follow_row.followed_id = comment.author_id
        )
      )
      and (
        caller_id is null
        or not exists (
          select 1
          from public.community_mutes mute_row
          where mute_row.muter_id = caller_id
            and mute_row.muted_id = comment.author_id
        )
      )

    union all

    select
      'prediction'::text as event_type,
      prediction.id as event_id,
      ('prediction:' || prediction.id::text)::text as event_key,
      prediction.settled_at as event_at,
      prediction.user_id as author_id,
      profile.username,
      coalesce(profile.avatar_key, 'oracle')::text as avatar_key,
      coalesce(profile.profile_theme, 'aurora')::text as profile_theme,
      coalesce(profile.rank, 'Observador')::text as rank,
      market.id as market_id,
      market.question as market_question,
      market.category as market_category,
      null::text as comment_body,
      false as comment_is_spoiler,
      false as comment_is_reply,
      prediction.option_selected as prediction_option,
      prediction.resolution_result as prediction_result,
      prediction.is_correct as prediction_is_correct,
      prediction.prestige_change as prediction_prestige_change,
      (
        select count(*)
        from public.community_prediction_reactions reaction
        where reaction.prediction_id = prediction.id
      ) as reaction_count,
      exists (
        select 1
        from public.community_prediction_reactions reaction
        where reaction.prediction_id = prediction.id
          and reaction.user_id = caller_id
      ) as viewer_reacted,
      caller_id is not null
        and prediction.user_id <> caller_id
        as viewer_can_react,
      false as viewer_has_open_report
    from public.predictions prediction
    join public.profiles profile on profile.id = prediction.user_id
    join public.markets market on market.id = prediction.market_id
    where prediction.settled_at is not null
      and (
        before_event_at_input is null
        or (prediction.settled_at, 'prediction:' || prediction.id::text)
          < (before_event_at_input, before_event_key_input)
      )
      and (
        normalized_mode = 'community'
        or exists (
          select 1
          from public.community_follows follow_row
          where follow_row.follower_id = caller_id
            and follow_row.followed_id = prediction.user_id
        )
      )
      and (
        caller_id is null
        or not exists (
          select 1
          from public.community_mutes mute_row
          where mute_row.muter_id = caller_id
            and mute_row.muted_id = prediction.user_id
        )
      )
  )
  select
    events.event_type,
    events.event_id,
    events.event_key,
    events.event_at,
    events.author_id,
    events.username,
    events.avatar_key,
    events.profile_theme,
    events.rank,
    events.market_id,
    events.market_question,
    events.market_category,
    events.comment_body,
    events.comment_is_spoiler,
    events.comment_is_reply,
    events.prediction_option,
    events.prediction_result,
    events.prediction_is_correct,
    events.prediction_prestige_change,
    events.reaction_count,
    events.viewer_reacted,
    events.viewer_can_react,
    events.viewer_has_open_report
  from events
  where before_event_at_input is null
    or (events.event_at, events.event_key) < (before_event_at_input, before_event_key_input)
  order by events.event_at desc, events.event_key desc
  limit greatest(1, least(coalesce(limit_count, 13), 25));
end;
$$;

comment on function public.get_public_community_feed(text, timestamptz, text, integer) is
  'Feed cronologico de comentarios y predicciones liquidadas; nunca expone Karma ni predicciones activas.';

-- -----------------------------------------------------------------------------
-- 6. Cola y acciones administrativas de moderacion
-- -----------------------------------------------------------------------------

create or replace function public.get_admin_community_reports(
  status_filter_input text default 'Pendiente',
  before_created_at_input timestamptz default null,
  before_report_id_input uuid default null,
  limit_count integer default 21
)
returns table (
  report_id uuid,
  reporter_id uuid,
  reporter_username text,
  target_type text,
  target_id uuid,
  target_author_id uuid,
  reason text,
  detail text,
  target_snapshot jsonb,
  status text,
  decision text,
  review_note text,
  created_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_username text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_status text := coalesce(status_filter_input, 'Pendiente');
begin
  if not private.is_oraklo_admin() then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;

  if normalized_status not in ('Pendiente', 'Descartado', 'Actuado') then
    raise exception using errcode = '22023', message = 'INVALID_REPORT_STATUS';
  end if;

  return query
  select
    report.id as report_id,
    report.reporter_id,
    coalesce(reporter.username, '@Cuenta eliminada') as reporter_username,
    report.target_type,
    report.target_id,
    case
      when report.target_type = 'comment' then target_comment.author_id
      when report.target_type = 'profile' then target_profile.id
      else null
    end as target_author_id,
    report.reason,
    report.detail,
    report.target_snapshot,
    report.status,
    report.decision,
    report.review_note,
    report.created_at,
    report.reviewed_at,
    reviewer.username as reviewed_by_username
  from public.community_reports report
  left join public.profiles reporter on reporter.id = report.reporter_id
  left join public.community_comments target_comment
    on report.target_type = 'comment' and target_comment.id = report.target_id
  left join public.profiles target_profile
    on report.target_type = 'profile' and target_profile.id = report.target_id
  left join public.profiles reviewer on reviewer.id = report.reviewed_by
  where report.status = normalized_status
    and (
      before_created_at_input is null
      or (report.created_at, report.id) < (before_created_at_input, before_report_id_input)
    )
  order by report.created_at desc, report.id desc
  limit greatest(1, least(coalesce(limit_count, 21), 50));
end;
$$;

create or replace function public.review_community_report(
  report_id_input uuid,
  action_input text,
  review_note_input text default null,
  restriction_hours_input integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  normalized_action text := lower(coalesce(action_input, ''));
  clean_note text := nullif(btrim(coalesce(review_note_input, '')), '');
  report_record public.community_reports%rowtype;
  target_comment public.community_comments%rowtype;
  target_author_id uuid;
  restriction_record public.community_restrictions%rowtype;
  should_hide boolean;
  should_restrict boolean;
  final_status text;
begin
  if not private.is_oraklo_admin() then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;

  if normalized_action not in ('dismiss', 'hide', 'restrict', 'hide_and_restrict') then
    raise exception using errcode = '22023', message = 'INVALID_MODERATION_ACTION';
  end if;

  if clean_note is not null and char_length(clean_note) > 1000 then
    raise exception using errcode = '22023', message = 'REVIEW_NOTE_TOO_LONG';
  end if;

  select report.*
  into report_record
  from public.community_reports report
  where report.id = report_id_input
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'REPORT_NOT_FOUND';
  end if;

  if report_record.status <> 'Pendiente' then
    raise exception using errcode = 'P0001', message = 'REPORT_ALREADY_REVIEWED';
  end if;

  should_hide := normalized_action in ('hide', 'hide_and_restrict');
  should_restrict := normalized_action in ('restrict', 'hide_and_restrict');

  if report_record.target_type = 'comment' then
    select comment.*
    into target_comment
    from public.community_comments comment
    where comment.id = report_record.target_id
    for update;

    if found then
      target_author_id := target_comment.author_id;
    end if;

    if should_hide then
      if not found or target_comment.status <> 'Visible' then
        raise exception using errcode = 'P0001', message = 'COMMENT_NOT_ACTIONABLE';
      end if;

      update public.community_comments comment
      set
        status = 'Oculto',
        moderated_at = now(),
        moderated_by = caller_id,
        moderation_reason = coalesce(clean_note, report_record.reason),
        updated_at = now()
      where comment.id = target_comment.id;
    end if;
  else
    target_author_id := report_record.target_id;

    if should_hide then
      raise exception using errcode = '22023', message = 'PROFILE_CANNOT_BE_HIDDEN';
    end if;

    if not exists (
      select 1
      from public.profiles profile
      where profile.id = target_author_id
    ) then
      raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND';
    end if;
  end if;

  if should_restrict then
    if target_author_id is null then
      raise exception using errcode = 'P0001', message = 'TARGET_ACCOUNT_UNAVAILABLE';
    end if;

    if exists (
      select 1
      from auth.users target_user
      where target_user.id = target_author_id
        and coalesce(target_user.raw_app_meta_data ->> 'oraklo_admin', 'false') = 'true'
    ) then
      raise exception using errcode = '42501', message = 'ADMIN_CANNOT_BE_RESTRICTED';
    end if;

    update public.community_restrictions restriction
    set active = false
    where restriction.user_id = target_author_id
      and restriction.active = true;

    insert into public.community_restrictions (
      user_id,
      reason,
      restricted_until,
      created_by
    ) values (
      target_author_id,
      coalesce(clean_note, report_record.reason),
      now() + make_interval(hours => greatest(1, least(coalesce(restriction_hours_input, 24), 8760))),
      caller_id
    )
    returning * into restriction_record;
  end if;

  final_status := case when normalized_action = 'dismiss' then 'Descartado' else 'Actuado' end;

  update public.community_reports report
  set
    status = final_status,
    decision = normalized_action,
    review_note = clean_note,
    reviewed_at = now(),
    reviewed_by = caller_id
  where report.id = report_record.id;

  insert into public.community_moderation_actions (
    admin_id,
    action_type,
    target_type,
    target_id,
    report_id,
    reason,
    metadata
  ) values (
    caller_id,
    normalized_action,
    report_record.target_type,
    report_record.target_id,
    report_record.id,
    clean_note,
    jsonb_build_object(
      'restriction_id', restriction_record.id,
      'restricted_until', restriction_record.restricted_until
    )
  );

  return jsonb_build_object(
    'report_id', report_record.id,
    'status', final_status,
    'decision', normalized_action,
    'target_type', report_record.target_type,
    'target_id', report_record.target_id,
    'restriction_id', restriction_record.id,
    'restricted_until', restriction_record.restricted_until
  );
end;
$$;

create or replace function public.get_admin_hidden_comments(
  before_moderated_at_input timestamptz default null,
  before_comment_id_input uuid default null,
  limit_count integer default 21
)
returns table (
  comment_id uuid,
  author_id uuid,
  author_username text,
  market_id text,
  market_question text,
  body text,
  is_spoiler boolean,
  created_at timestamptz,
  moderated_at timestamptz,
  moderated_by_username text,
  moderation_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_oraklo_admin() then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;

  return query
  select
    comment.id as comment_id,
    comment.author_id,
    coalesce(author_profile.username, '@Cuenta eliminada') as author_username,
    comment.market_id,
    market.question as market_question,
    comment.body,
    comment.is_spoiler,
    comment.created_at,
    comment.moderated_at,
    moderator_profile.username as moderated_by_username,
    comment.moderation_reason
  from public.community_comments comment
  join public.markets market on market.id = comment.market_id
  left join public.profiles author_profile on author_profile.id = comment.author_id
  left join public.profiles moderator_profile on moderator_profile.id = comment.moderated_by
  where comment.status = 'Oculto'
    and (
      before_moderated_at_input is null
      or (comment.moderated_at, comment.id) < (before_moderated_at_input, before_comment_id_input)
    )
  order by comment.moderated_at desc, comment.id desc
  limit greatest(1, least(coalesce(limit_count, 21), 50));
end;
$$;

create or replace function public.restore_community_comment(
  comment_id_input uuid,
  reason_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_reason text := nullif(btrim(coalesce(reason_input, '')), '');
  comment_record public.community_comments%rowtype;
begin
  if not private.is_oraklo_admin() then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;

  if clean_reason is not null and char_length(clean_reason) > 1000 then
    raise exception using errcode = '22023', message = 'REVIEW_NOTE_TOO_LONG';
  end if;

  select comment.*
  into comment_record
  from public.community_comments comment
  where comment.id = comment_id_input
  for update;

  if not found or comment_record.status <> 'Oculto' then
    raise exception using errcode = 'P0002', message = 'HIDDEN_COMMENT_NOT_FOUND';
  end if;

  update public.community_comments comment
  set
    status = 'Visible',
    moderated_at = null,
    moderated_by = null,
    moderation_reason = null,
    updated_at = now()
  where comment.id = comment_record.id;

  insert into public.community_moderation_actions (
    admin_id,
    action_type,
    target_type,
    target_id,
    reason,
    metadata
  ) values (
    caller_id,
    'restore',
    'comment',
    comment_record.id,
    clean_reason,
    jsonb_build_object('previous_reason', comment_record.moderation_reason)
  );

  return jsonb_build_object(
    'comment_id', comment_record.id,
    'status', 'Visible'
  );
end;
$$;

create or replace function public.get_admin_active_restrictions(
  before_created_at_input timestamptz default null,
  before_restriction_id_input uuid default null,
  limit_count integer default 21
)
returns table (
  restriction_id uuid,
  user_id uuid,
  username text,
  reason text,
  restricted_until timestamptz,
  created_at timestamptz,
  created_by_username text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_oraklo_admin() then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;

  return query
  select
    restriction.id as restriction_id,
    restriction.user_id,
    coalesce(target_profile.username, '@Cuenta eliminada') as username,
    restriction.reason,
    restriction.restricted_until,
    restriction.created_at,
    creator_profile.username as created_by_username
  from public.community_restrictions restriction
  left join public.profiles target_profile on target_profile.id = restriction.user_id
  left join public.profiles creator_profile on creator_profile.id = restriction.created_by
  where restriction.active = true
    and restriction.restricted_until > now()
    and (
      before_created_at_input is null
      or (restriction.created_at, restriction.id) < (before_created_at_input, before_restriction_id_input)
    )
  order by restriction.created_at desc, restriction.id desc
  limit greatest(1, least(coalesce(limit_count, 21), 50));
end;
$$;

create or replace function public.lift_community_restriction(
  restriction_id_input uuid,
  reason_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_reason text := nullif(btrim(coalesce(reason_input, '')), '');
  restriction_record public.community_restrictions%rowtype;
begin
  if not private.is_oraklo_admin() then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;

  if clean_reason is not null and char_length(clean_reason) > 1000 then
    raise exception using errcode = '22023', message = 'REVIEW_NOTE_TOO_LONG';
  end if;

  select restriction.*
  into restriction_record
  from public.community_restrictions restriction
  where restriction.id = restriction_id_input
  for update;

  if not found or not restriction_record.active then
    raise exception using errcode = 'P0002', message = 'ACTIVE_RESTRICTION_NOT_FOUND';
  end if;

  update public.community_restrictions restriction
  set
    active = false,
    lifted_at = now(),
    lifted_by = caller_id,
    lift_reason = clean_reason
  where restriction.id = restriction_record.id;

  insert into public.community_moderation_actions (
    admin_id,
    action_type,
    target_type,
    target_id,
    reason,
    metadata
  ) values (
    caller_id,
    'lift_restriction',
    'restriction',
    restriction_record.id,
    clean_reason,
    jsonb_build_object(
      'user_id', restriction_record.user_id,
      'previous_restricted_until', restriction_record.restricted_until
    )
  );

  return jsonb_build_object(
    'restriction_id', restriction_record.id,
    'active', false
  );
end;
$$;

revoke all on function private.refresh_market_comment_count() from public, anon, authenticated;

drop trigger if exists refresh_market_comment_count on public.community_comments;
create trigger refresh_market_comment_count
after insert or delete or update of status, market_id
on public.community_comments
for each row execute function private.refresh_market_comment_count();

-- Sustituye cualquier contador provisional anterior por el total social real.
update public.markets m
set comments_count = (
  select count(*)::integer
  from public.community_comments c
  where c.market_id = m.id
    and c.status = 'Visible'
);

-- -----------------------------------------------------------------------------
-- 7. Debate publico de mercados
-- -----------------------------------------------------------------------------

create or replace function public.get_public_market_comments(
  market_id_input text,
  before_created_at_input timestamptz default null,
  before_comment_id_input uuid default null,
  limit_count integer default 11
)
returns table (
  comment_id uuid,
  parent_id uuid,
  thread_id uuid,
  thread_created_at timestamptz,
  is_reply boolean,
  author_id uuid,
  username text,
  avatar_key text,
  profile_theme text,
  rank text,
  body text,
  is_spoiler boolean,
  status text,
  created_at timestamptz,
  edited_at timestamptz,
  reaction_count bigint,
  viewer_reacted boolean,
  viewer_can_edit boolean,
  viewer_can_react boolean,
  viewer_has_open_report boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select (select auth.uid()) as id
  ),
  parent_page as (
    select c.*
    from public.community_comments c
    cross join viewer v
    where c.market_id = market_id_input
      and c.parent_id is null
      and (
        c.status = 'Visible'
        or exists (
          select 1
          from public.community_comments child
          where child.parent_id = c.id
            and child.status = 'Visible'
        )
      )
      and (
        before_created_at_input is null
        or (c.created_at, c.id) < (before_created_at_input, before_comment_id_input)
      )
      and (
        v.id is null
        or c.author_id is null
        or not exists (
          select 1
          from public.community_mutes mu
          where mu.muter_id = v.id
            and mu.muted_id = c.author_id
        )
      )
    order by c.created_at desc, c.id desc
    limit greatest(1, least(coalesce(limit_count, 11), 21))
  ),
  thread_rows as (
    select
      parent.*,
      parent.id as root_id,
      parent.created_at as root_created_at,
      false as row_is_reply
    from parent_page parent

    union all

    select
      reply.*,
      parent.id as root_id,
      parent.created_at as root_created_at,
      true as row_is_reply
    from parent_page parent
    join public.community_comments reply on reply.parent_id = parent.id
    cross join viewer v
    where reply.status = 'Visible'
      and (
        v.id is null
        or reply.author_id is null
        or not exists (
          select 1
          from public.community_mutes mu
          where mu.muter_id = v.id
            and mu.muted_id = reply.author_id
        )
      )
  )
  select
    row_data.id as comment_id,
    row_data.parent_id,
    row_data.root_id as thread_id,
    row_data.root_created_at as thread_created_at,
    row_data.row_is_reply as is_reply,
    case when row_data.status = 'Visible' then row_data.author_id else null end as author_id,
    case
      when row_data.status <> 'Visible' then null
      else coalesce(profile.username, '@Cuenta eliminada')
    end as username,
    case when row_data.status = 'Visible' then coalesce(profile.avatar_key, 'oracle') else null end as avatar_key,
    case when row_data.status = 'Visible' then coalesce(profile.profile_theme, 'aurora') else null end as profile_theme,
    case when row_data.status = 'Visible' then coalesce(profile.rank, 'Observador') else null end as rank,
    case when row_data.status = 'Visible' then row_data.body else null end as body,
    case when row_data.status = 'Visible' then row_data.is_spoiler else false end as is_spoiler,
    row_data.status,
    row_data.created_at,
    row_data.edited_at,
    case
      when row_data.status = 'Visible' then (
        select count(*)
        from public.community_comment_reactions reaction
        where reaction.comment_id = row_data.id
      )
      else 0
    end as reaction_count,
    case
      when row_data.status = 'Visible' then exists (
        select 1
        from public.community_comment_reactions reaction
        cross join viewer v
        where reaction.comment_id = row_data.id
          and reaction.user_id = v.id
      )
      else false
    end as viewer_reacted,
    row_data.status = 'Visible'
      and row_data.author_id = (select id from viewer)
      as viewer_can_edit,
    row_data.status = 'Visible'
      and (select id from viewer) is not null
      and row_data.author_id is not null
      and row_data.author_id <> (select id from viewer)
      as viewer_can_react,
    case
      when row_data.status = 'Visible' then exists (
        select 1
        from public.community_reports report
        where report.reporter_id = (select id from viewer)
          and report.target_type = 'comment'
          and report.target_id = row_data.id
          and report.status = 'Pendiente'
      )
      else false
    end as viewer_has_open_report
  from thread_rows row_data
  left join public.profiles profile on profile.id = row_data.author_id
  order by
    row_data.root_created_at desc,
    row_data.root_id desc,
    row_data.row_is_reply asc,
    row_data.created_at asc,
    row_data.id asc;
$$;

comment on function public.get_public_market_comments(text, timestamptz, uuid, integer) is
  'Devuelve debates publicos por cursor sin exponer datos privados del predictor.';

create or replace function public.create_market_comment(
  market_id_input text,
  body_input text,
  parent_id_input uuid default null,
  is_spoiler_input boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_body text := btrim(coalesce(body_input, ''));
  parent_record public.community_comments%rowtype;
  inserted_comment public.community_comments%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  if private.is_community_restricted(caller_id) then
    raise exception using errcode = 'P0001', message = 'COMMUNITY_RESTRICTED';
  end if;

  if not exists (select 1 from public.markets m where m.id = market_id_input) then
    raise exception using errcode = 'P0002', message = 'MARKET_NOT_FOUND';
  end if;

  if char_length(clean_body) < 1 or char_length(clean_body) > 500 then
    raise exception using errcode = '22023', message = 'INVALID_COMMENT_LENGTH';
  end if;

  if (
    select count(*)
    from public.community_comments c
    where c.author_id = caller_id
      and c.created_at >= now() - interval '1 minute'
  ) >= 5 then
    raise exception using errcode = 'P0001', message = 'COMMENT_RATE_LIMIT';
  end if;

  if exists (
    select 1
    from public.community_comments c
    where c.author_id = caller_id
      and c.market_id = market_id_input
      and c.status = 'Visible'
      and lower(btrim(c.body)) = lower(clean_body)
      and c.created_at >= now() - interval '30 seconds'
  ) then
    raise exception using errcode = '23505', message = 'DUPLICATE_COMMENT';
  end if;

  if parent_id_input is not null then
    select c.*
    into parent_record
    from public.community_comments c
    where c.id = parent_id_input
    for share;

    if not found
      or parent_record.market_id <> market_id_input
      or parent_record.parent_id is not null
      or parent_record.status <> 'Visible' then
      raise exception using errcode = '22023', message = 'INVALID_COMMENT_PARENT';
    end if;
  end if;

  insert into public.community_comments (
    market_id,
    author_id,
    parent_id,
    body,
    is_spoiler
  ) values (
    market_id_input,
    caller_id,
    parent_id_input,
    clean_body,
    coalesce(is_spoiler_input, false)
  )
  returning * into inserted_comment;

  return jsonb_build_object(
    'id', inserted_comment.id,
    'market_id', inserted_comment.market_id,
    'parent_id', inserted_comment.parent_id,
    'body', inserted_comment.body,
    'is_spoiler', inserted_comment.is_spoiler,
    'status', inserted_comment.status,
    'created_at', inserted_comment.created_at
  );
end;
$$;

create or replace function public.update_market_comment(
  comment_id_input uuid,
  body_input text,
  is_spoiler_input boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_body text := btrim(coalesce(body_input, ''));
  current_comment public.community_comments%rowtype;
  updated_comment public.community_comments%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  if private.is_community_restricted(caller_id) then
    raise exception using errcode = 'P0001', message = 'COMMUNITY_RESTRICTED';
  end if;

  if char_length(clean_body) < 1 or char_length(clean_body) > 500 then
    raise exception using errcode = '22023', message = 'INVALID_COMMENT_LENGTH';
  end if;

  select c.*
  into current_comment
  from public.community_comments c
  where c.id = comment_id_input
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'COMMENT_NOT_FOUND';
  end if;

  if current_comment.author_id <> caller_id or current_comment.status <> 'Visible' then
    raise exception using errcode = '42501', message = 'COMMENT_NOT_EDITABLE';
  end if;

  update public.community_comments c
  set
    body = clean_body,
    is_spoiler = coalesce(is_spoiler_input, false),
    updated_at = now(),
    edited_at = now()
  where c.id = comment_id_input
  returning * into updated_comment;

  return jsonb_build_object(
    'id', updated_comment.id,
    'body', updated_comment.body,
    'is_spoiler', updated_comment.is_spoiler,
    'edited_at', updated_comment.edited_at
  );
end;
$$;

create or replace function public.delete_market_comment(comment_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_comment public.community_comments%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  select c.*
  into current_comment
  from public.community_comments c
  where c.id = comment_id_input
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'COMMENT_NOT_FOUND';
  end if;

  if current_comment.author_id <> caller_id then
    raise exception using errcode = '42501', message = 'COMMENT_NOT_OWNED';
  end if;

  if current_comment.status <> 'Eliminado' then
    update public.community_comments c
    set
      status = 'Eliminado',
      deleted_at = now(),
      updated_at = now()
    where c.id = comment_id_input;
  end if;

  return jsonb_build_object('id', comment_id_input, 'status', 'Eliminado');
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Seguimiento, silencios y reaccion positiva
-- -----------------------------------------------------------------------------

create or replace function public.get_public_social_profile(profile_id_input uuid)
returns table (
  profile_id uuid,
  follower_count bigint,
  following_count bigint,
  viewer_is_self boolean,
  viewer_is_following boolean,
  viewer_has_muted boolean,
  viewer_has_open_report boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id as profile_id,
    (
      select count(*)
      from public.community_follows follow_row
      where follow_row.followed_id = profile.id
    ) as follower_count,
    (
      select count(*)
      from public.community_follows follow_row
      where follow_row.follower_id = profile.id
    ) as following_count,
    profile.id = (select auth.uid()) as viewer_is_self,
    exists (
      select 1
      from public.community_follows follow_row
      where follow_row.follower_id = (select auth.uid())
        and follow_row.followed_id = profile.id
    ) as viewer_is_following,
    exists (
      select 1
      from public.community_mutes mute_row
      where mute_row.muter_id = (select auth.uid())
        and mute_row.muted_id = profile.id
    ) as viewer_has_muted,
    exists (
      select 1
      from public.community_reports report
      where report.reporter_id = (select auth.uid())
        and report.target_type = 'profile'
        and report.target_id = profile.id
        and report.status = 'Pendiente'
    ) as viewer_has_open_report
  from public.profiles profile
  where profile.id = profile_id_input;
$$;

create or replace function public.set_profile_following(
  profile_id_input uuid,
  following_input boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  follower_total bigint;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  if caller_id = profile_id_input then
    raise exception using errcode = '22023', message = 'CANNOT_FOLLOW_SELF';
  end if;

  if not exists (select 1 from public.profiles p where p.id = profile_id_input) then
    raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND';
  end if;

  if coalesce(following_input, false) then
    if private.is_community_restricted(caller_id) then
      raise exception using errcode = 'P0001', message = 'COMMUNITY_RESTRICTED';
    end if;

    if exists (
      select 1
      from public.community_mutes mute_row
      where mute_row.muter_id = caller_id
        and mute_row.muted_id = profile_id_input
    ) then
      raise exception using errcode = 'P0001', message = 'PROFILE_IS_MUTED';
    end if;

    insert into public.community_follows (follower_id, followed_id)
    values (caller_id, profile_id_input)
    on conflict (follower_id, followed_id) do nothing;
  else
    delete from public.community_follows follow_row
    where follow_row.follower_id = caller_id
      and follow_row.followed_id = profile_id_input;
  end if;

  select count(*)
  into follower_total
  from public.community_follows follow_row
  where follow_row.followed_id = profile_id_input;

  return jsonb_build_object(
    'profile_id', profile_id_input,
    'is_following', coalesce(following_input, false),
    'follower_count', follower_total
  );
end;
$$;

create or replace function public.set_profile_muted(
  profile_id_input uuid,
  muted_input boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  if caller_id = profile_id_input then
    raise exception using errcode = '22023', message = 'CANNOT_MUTE_SELF';
  end if;

  if not exists (select 1 from public.profiles p where p.id = profile_id_input) then
    raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND';
  end if;

  if coalesce(muted_input, false) then
    insert into public.community_mutes (muter_id, muted_id)
    values (caller_id, profile_id_input)
    on conflict (muter_id, muted_id) do nothing;

    delete from public.community_follows follow_row
    where follow_row.follower_id = caller_id
      and follow_row.followed_id = profile_id_input;
  else
    delete from public.community_mutes mute_row
    where mute_row.muter_id = caller_id
      and mute_row.muted_id = profile_id_input;
  end if;

  return jsonb_build_object(
    'profile_id', profile_id_input,
    'is_muted', coalesce(muted_input, false),
    'is_following', false
  );
end;
$$;

create or replace function public.get_my_following(
  before_created_at_input timestamptz default null,
  before_profile_id_input uuid default null,
  limit_count integer default 21
)
returns table (
  profile_id uuid,
  username text,
  rank text,
  avatar_key text,
  profile_theme text,
  followed_at timestamptz,
  follower_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  return query
  select
    profile.id as profile_id,
    profile.username,
    profile.rank,
    coalesce(profile.avatar_key, 'oracle') as avatar_key,
    coalesce(profile.profile_theme, 'aurora') as profile_theme,
    follow_row.created_at as followed_at,
    (
      select count(*)
      from public.community_follows follower
      where follower.followed_id = profile.id
    ) as follower_count
  from public.community_follows follow_row
  join public.profiles profile on profile.id = follow_row.followed_id
  where follow_row.follower_id = caller_id
    and (
      before_created_at_input is null
      or (follow_row.created_at, follow_row.followed_id)
        < (before_created_at_input, before_profile_id_input)
    )
    and not exists (
      select 1
      from public.community_mutes mute_row
      where mute_row.muter_id = caller_id
        and mute_row.muted_id = follow_row.followed_id
    )
  order by follow_row.created_at desc, follow_row.followed_id desc
  limit greatest(1, least(coalesce(limit_count, 21), 51));
end;
$$;

create or replace function public.set_community_reaction(
  target_type_input text,
  target_id_input uuid,
  active_input boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_comment public.community_comments%rowtype;
  target_prediction public.predictions%rowtype;
  reaction_total bigint;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  if target_type_input not in ('comment', 'prediction') then
    raise exception using errcode = '22023', message = 'INVALID_REACTION_TARGET';
  end if;

  if coalesce(active_input, false) and private.is_community_restricted(caller_id) then
    raise exception using errcode = 'P0001', message = 'COMMUNITY_RESTRICTED';
  end if;

  if target_type_input = 'comment' then
    select c.*
    into target_comment
    from public.community_comments c
    where c.id = target_id_input;

    if not found or target_comment.status <> 'Visible' then
      raise exception using errcode = 'P0002', message = 'COMMENT_NOT_FOUND';
    end if;

    if target_comment.author_id is null or target_comment.author_id = caller_id then
      raise exception using errcode = '22023', message = 'CANNOT_REACT_TO_OWN_CONTENT';
    end if;

    if coalesce(active_input, false) then
      insert into public.community_comment_reactions (comment_id, user_id)
      values (target_id_input, caller_id)
      on conflict (comment_id, user_id) do nothing;
    else
      delete from public.community_comment_reactions reaction
      where reaction.comment_id = target_id_input
        and reaction.user_id = caller_id;
    end if;

    select count(*)
    into reaction_total
    from public.community_comment_reactions reaction
    where reaction.comment_id = target_id_input;
  else
    select prediction.*
    into target_prediction
    from public.predictions prediction
    where prediction.id = target_id_input;

    if not found or target_prediction.settled_at is null then
      raise exception using errcode = 'P0002', message = 'PUBLIC_PREDICTION_NOT_FOUND';
    end if;

    if target_prediction.user_id = caller_id then
      raise exception using errcode = '22023', message = 'CANNOT_REACT_TO_OWN_CONTENT';
    end if;

    if coalesce(active_input, false) then
      insert into public.community_prediction_reactions (prediction_id, user_id)
      values (target_id_input, caller_id)
      on conflict (prediction_id, user_id) do nothing;
    else
      delete from public.community_prediction_reactions reaction
      where reaction.prediction_id = target_id_input
        and reaction.user_id = caller_id;
    end if;

    select count(*)
    into reaction_total
    from public.community_prediction_reactions reaction
    where reaction.prediction_id = target_id_input;
  end if;

  return jsonb_build_object(
    'target_type', target_type_input,
    'target_id', target_id_input,
    'active', coalesce(active_input, false),
    'reaction_count', reaction_total
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Reportes de la comunidad
-- -----------------------------------------------------------------------------

create or replace function public.create_community_report(
  target_type_input text,
  target_id_input uuid,
  reason_input text,
  detail_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_detail text := nullif(btrim(coalesce(detail_input, '')), '');
  target_comment public.community_comments%rowtype;
  target_profile public.profiles%rowtype;
  snapshot jsonb;
  inserted_report public.community_reports%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  if target_type_input not in ('comment', 'profile') then
    raise exception using errcode = '22023', message = 'INVALID_REPORT_TARGET';
  end if;

  if reason_input not in ('spam', 'harassment', 'hate', 'illegal', 'impersonation', 'other') then
    raise exception using errcode = '22023', message = 'INVALID_REPORT_REASON';
  end if;

  if clean_detail is not null and char_length(clean_detail) > 1000 then
    raise exception using errcode = '22023', message = 'REPORT_DETAIL_TOO_LONG';
  end if;

  if (
    select count(*)
    from public.community_reports report
    where report.reporter_id = caller_id
      and report.created_at >= now() - interval '1 hour'
  ) >= 20 then
    raise exception using errcode = 'P0001', message = 'REPORT_RATE_LIMIT';
  end if;

  if exists (
    select 1
    from public.community_reports report
    where report.reporter_id = caller_id
      and report.target_type = target_type_input
      and report.target_id = target_id_input
      and report.status = 'Pendiente'
  ) then
    raise exception using errcode = '23505', message = 'REPORT_ALREADY_OPEN';
  end if;

  if target_type_input = 'comment' then
    select c.*
    into target_comment
    from public.community_comments c
    where c.id = target_id_input;

    if not found or target_comment.status <> 'Visible' then
      raise exception using errcode = 'P0002', message = 'COMMENT_NOT_FOUND';
    end if;

    if target_comment.author_id is null or target_comment.author_id = caller_id then
      raise exception using errcode = '22023', message = 'CANNOT_REPORT_OWN_CONTENT';
    end if;

    select jsonb_build_object(
      'comment_id', target_comment.id,
      'body', target_comment.body,
      'author_id', target_comment.author_id,
      'author_username', coalesce(profile.username, '@Cuenta eliminada'),
      'market_id', target_comment.market_id,
      'market_question', market.question,
      'captured_at', now()
    )
    into snapshot
    from public.markets market
    left join public.profiles profile on profile.id = target_comment.author_id
    where market.id = target_comment.market_id;
  else
    select profile.*
    into target_profile
    from public.profiles profile
    where profile.id = target_id_input;

    if not found then
      raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND';
    end if;

    if target_profile.id = caller_id then
      raise exception using errcode = '22023', message = 'CANNOT_REPORT_OWN_CONTENT';
    end if;

    snapshot := jsonb_build_object(
      'profile_id', target_profile.id,
      'username', target_profile.username,
      'bio', coalesce(target_profile.bio, ''),
      'captured_at', now()
    );
  end if;

  insert into public.community_reports (
    reporter_id,
    target_type,
    target_id,
    reason,
    detail,
    target_snapshot
  ) values (
    caller_id,
    target_type_input,
    target_id_input,
    reason_input,
    clean_detail,
    snapshot
  )
  returning * into inserted_report;

  return jsonb_build_object(
    'id', inserted_report.id,
    'status', inserted_report.status,
    'target_type', inserted_report.target_type,
    'target_id', inserted_report.target_id,
    'created_at', inserted_report.created_at
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Permisos de la API RPC
-- -----------------------------------------------------------------------------

revoke all on function public.get_public_market_comments(text, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.create_market_comment(text, text, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.update_market_comment(uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.delete_market_comment(uuid)
  from public, anon, authenticated;
revoke all on function public.get_public_social_profile(uuid)
  from public, anon, authenticated;
revoke all on function public.set_profile_following(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.set_profile_muted(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.get_my_following(timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.set_community_reaction(text, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.create_community_report(text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.get_public_community_feed(text, timestamptz, text, integer)
  from public, anon, authenticated;
revoke all on function public.get_admin_community_reports(text, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.review_community_report(uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.get_admin_hidden_comments(timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.restore_community_comment(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_admin_active_restrictions(timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.lift_community_restriction(uuid, text)
  from public, anon, authenticated;

grant execute on function public.get_public_market_comments(text, timestamptz, uuid, integer)
  to anon, authenticated;
grant execute on function public.get_public_social_profile(uuid)
  to anon, authenticated;
grant execute on function public.get_public_community_feed(text, timestamptz, text, integer)
  to anon, authenticated;

grant execute on function public.create_market_comment(text, text, uuid, boolean)
  to authenticated;
grant execute on function public.update_market_comment(uuid, text, boolean)
  to authenticated;
grant execute on function public.delete_market_comment(uuid)
  to authenticated;
grant execute on function public.set_profile_following(uuid, boolean)
  to authenticated;
grant execute on function public.set_profile_muted(uuid, boolean)
  to authenticated;
grant execute on function public.get_my_following(timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.set_community_reaction(text, uuid, boolean)
  to authenticated;
grant execute on function public.create_community_report(text, uuid, text, text)
  to authenticated;
grant execute on function public.get_admin_community_reports(text, timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.review_community_report(uuid, text, text, integer)
  to authenticated;
grant execute on function public.get_admin_hidden_comments(timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.restore_community_comment(uuid, text)
  to authenticated;
grant execute on function public.get_admin_active_restrictions(timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.lift_community_restriction(uuid, text)
  to authenticated;

comment on function public.create_market_comment(text, text, uuid, boolean) is
  'Crea un comentario o una respuesta de un solo nivel con controles de abuso.';
comment on function public.update_market_comment(uuid, text, boolean) is
  'Edita exclusivamente contenido visible de la cuenta autenticada.';
comment on function public.delete_market_comment(uuid) is
  'Borrado logico por la cuenta autora; permanece disponible para auditoria.';
comment on function public.get_public_social_profile(uuid) is
  'Contadores publicos y estado social privado para la cuenta que consulta.';
comment on function public.get_my_following(timestamptz, uuid, integer) is
  'Lista privada y paginada de cuentas seguidas por la persona autenticada.';
comment on function public.set_community_reaction(text, uuid, boolean) is
  'Activa o retira Buena lectura sin modificar Karma, Prestigio ni rangos.';
comment on function public.create_community_report(text, uuid, text, text) is
  'Crea un reporte privado sin publicar la identidad del informante.';
comment on function public.review_community_report(uuid, text, text, integer) is
  'Revisa un reporte y aplica, de forma atomica, la decision humana autorizada.';
comment on function public.restore_community_comment(uuid, text) is
  'Restaura contenido oculto y registra la decision administrativa.';
comment on function public.lift_community_restriction(uuid, text) is
  'Levanta una restriccion social y conserva el registro de auditoria.';
