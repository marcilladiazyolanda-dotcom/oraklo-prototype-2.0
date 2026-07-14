-- ORAKLO · Paso 10: perfil público como currículum predictivo
--
-- Privacidad confirmada:
--   * Solo se publican identidad competitiva y predicciones ya liquidadas.
--   * El Karma disponible nunca forma parte de estas RPC.
--   * Las predicciones activas y pendientes continúan siendo privadas.
--   * Las temporadas siguen desactivadas; este cambio solo muestra su estado.

-- Acelera el historial público y las estadísticas por usuario sin indexar
-- predicciones que todavía no han sido liquidadas.
create index if not exists predictions_public_profile_history_idx
  on public.predictions (user_id, settled_at desc, id desc)
  include (market_id, is_correct)
  where settled_at is not null;

-- -----------------------------------------------------------------------------
-- 1. Resumen público del predictor
-- -----------------------------------------------------------------------------

create or replace function public.get_public_predictor_profile(
  profile_id_input uuid
)
returns table (
  id uuid,
  username text,
  prestige integer,
  rank text,
  member_since timestamptz,
  global_position bigint,
  resolved_predictions integer,
  correct_predictions integer,
  missed_predictions integer,
  annulled_predictions integer,
  accuracy numeric,
  current_streak integer,
  best_streak integer,
  best_category text,
  best_category_resolved integer,
  best_category_correct integer,
  best_category_accuracy numeric,
  current_rank_min integer,
  next_rank text,
  next_rank_min integer,
  prestige_to_next_rank integer,
  season_state text,
  season_id uuid,
  season_name text,
  season_position bigint,
  season_prestige integer,
  is_own_profile boolean
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
        as correct_predictions,
      count(*) filter (where pr.is_correct is false)::integer
        as missed_predictions,
      count(*) filter (
        where pr.settled_at is not null
          and pr.is_correct is null
      )::integer as annulled_predictions
    from public.predictions pr
    where pr.settled_at is not null
    group by pr.user_id
  ),
  global_candidates as (
    select
      p.id,
      p.prestige,
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
  target_decisions as (
    select
      pr.id,
      pr.is_correct,
      pr.settled_at,
      sum(case when pr.is_correct is false then 1 else 0 end) over (
        order by pr.settled_at, pr.id
        rows between unbounded preceding and current row
      ) as miss_group,
      sum(case when pr.is_correct is false then 1 else 0 end) over (
        order by pr.settled_at desc, pr.id desc
        rows between unbounded preceding and current row
      ) as reverse_misses
    from public.predictions pr
    where pr.user_id = profile_id_input
      and pr.settled_at is not null
      and pr.is_correct is not null
  ),
  target_runs as (
    select
      td.miss_group,
      count(*) filter (where td.is_correct is true)::integer as hit_streak
    from target_decisions td
    group by td.miss_group
  ),
  streak_stats as (
    select
      coalesce((
        select count(*)::integer
        from target_decisions td
        where td.is_correct is true
          and td.reverse_misses = 0
      ), 0) as current_streak,
      coalesce((select max(tr.hit_streak) from target_runs tr), 0)::integer
        as best_streak
  ),
  target_category_stats as (
    select
      m.category,
      count(*)::integer as resolved_predictions,
      count(*) filter (where pr.is_correct is true)::integer
        as correct_predictions,
      round(
        count(*) filter (where pr.is_correct is true)::numeric * 100
          / count(*)::numeric,
        1
      ) as accuracy
    from public.predictions pr
    join public.markets m on m.id = pr.market_id
    where pr.user_id = profile_id_input
      and pr.settled_at is not null
      and pr.is_correct is not null
    group by m.category
  ),
  best_category as (
    select tcs.*
    from target_category_stats tcs
    order by
      tcs.correct_predictions desc,
      tcs.accuracy desc,
      tcs.resolved_predictions desc,
      tcs.category
    limit 1
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
  season_ranked as (
    select
      ss.user_id,
      ss.season_prestige,
      row_number() over (
        order by
          ss.season_prestige desc,
          ss.correct_predictions desc,
          case
            when ss.resolved_predictions = 0 then 0::numeric
            else ss.correct_predictions::numeric * 100
              / ss.resolved_predictions::numeric
          end desc,
          ss.first_settled_at,
          ss.user_id
      ) as position
    from season_stats ss
  ),
  competition as (
    select *
    from public.get_public_competition_status()
  )
  select
    p.id,
    p.username,
    p.prestige,
    p.rank,
    p.created_at as member_since,
    gr.position as global_position,
    coalesce(ps.resolved_predictions, 0) as resolved_predictions,
    coalesce(ps.correct_predictions, 0) as correct_predictions,
    coalesce(ps.missed_predictions, 0) as missed_predictions,
    coalesce(ps.annulled_predictions, 0) as annulled_predictions,
    case
      when coalesce(ps.resolved_predictions, 0) = 0 then 0::numeric
      else round(
        ps.correct_predictions::numeric * 100
          / ps.resolved_predictions::numeric,
        1
      )
    end as accuracy,
    streaks.current_streak,
    streaks.best_streak,
    bc.category as best_category,
    coalesce(bc.resolved_predictions, 0) as best_category_resolved,
    coalesce(bc.correct_predictions, 0) as best_category_correct,
    coalesce(bc.accuracy, 0::numeric) as best_category_accuracy,
    current_rank.min_prestige as current_rank_min,
    next_rank.name as next_rank,
    next_rank.min_prestige as next_rank_min,
    case
      when next_rank.min_prestige is null then 0
      else greatest(next_rank.min_prestige - p.prestige, 0)
    end::integer as prestige_to_next_rank,
    competition.state as season_state,
    competition.season_id,
    competition.season_name,
    sr.position as season_position,
    coalesce(sr.season_prestige, 0) as season_prestige,
    ((select auth.uid()) = p.id) as is_own_profile
  from public.profiles p
  left join prediction_stats ps on ps.user_id = p.id
  left join global_ranked gr on gr.id = p.id
  left join public.rank_definitions current_rank on current_rank.name = p.rank
  left join lateral (
    select rd.name, rd.min_prestige
    from public.rank_definitions rd
    where rd.min_prestige > p.prestige
    order by rd.min_prestige
    limit 1
  ) next_rank on true
  left join best_category bc on true
  left join season_ranked sr on sr.user_id = p.id
  cross join streak_stats streaks
  cross join competition
  where p.id = profile_id_input;
$function$;

revoke all on function public.get_public_predictor_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.get_public_predictor_profile(uuid)
  to anon, authenticated;

comment on function public.get_public_predictor_profile(uuid) is
  'Currículum público del predictor. No expone Karma ni predicciones sin liquidar.';

-- -----------------------------------------------------------------------------
-- 2. Especialidades públicas por categoría
-- -----------------------------------------------------------------------------

create or replace function public.get_public_predictor_specialties(
  profile_id_input uuid
)
returns table (
  "position" integer,
  category text,
  resolved_predictions integer,
  correct_predictions integer,
  missed_predictions integer,
  accuracy numeric,
  is_primary boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  with category_stats as (
    select
      m.category,
      count(*)::integer as resolved_predictions,
      count(*) filter (where pr.is_correct is true)::integer
        as correct_predictions,
      count(*) filter (where pr.is_correct is false)::integer
        as missed_predictions,
      round(
        count(*) filter (where pr.is_correct is true)::numeric * 100
          / count(*)::numeric,
        1
      ) as accuracy
    from public.predictions pr
    join public.markets m on m.id = pr.market_id
    where pr.user_id = profile_id_input
      and pr.settled_at is not null
      and pr.is_correct is not null
    group by m.category
  ),
  ranked as (
    select
      row_number() over (
        order by
          cs.correct_predictions desc,
          cs.accuracy desc,
          cs.resolved_predictions desc,
          cs.category
      )::integer as position,
      cs.*
    from category_stats cs
  )
  select
    r.position,
    r.category,
    r.resolved_predictions,
    r.correct_predictions,
    r.missed_predictions,
    r.accuracy,
    r.position = 1 as is_primary
  from ranked r
  order by r.position
  limit 6;
$function$;

revoke all on function public.get_public_predictor_specialties(uuid)
  from public, anon, authenticated;
grant execute on function public.get_public_predictor_specialties(uuid)
  to anon, authenticated;

comment on function public.get_public_predictor_specialties(uuid) is
  'Resultados públicos por categoría, contando únicamente predicciones decididas.';

-- -----------------------------------------------------------------------------
-- 3. Historial público paginado de predicciones liquidadas
-- -----------------------------------------------------------------------------

create or replace function public.get_public_predictor_history(
  profile_id_input uuid,
  before_settled_at_input timestamptz default null,
  before_prediction_id_input uuid default null,
  limit_count integer default 13
)
returns table (
  prediction_id uuid,
  market_id text,
  market_question text,
  market_category text,
  option_selected text,
  entry_percentage integer,
  option_difficulty text,
  karma_risked integer,
  karma_awarded integer,
  prestige_change integer,
  resolution_result text,
  is_correct boolean,
  predicted_at timestamptz,
  settled_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    pr.id as prediction_id,
    pr.market_id,
    m.question as market_question,
    m.category as market_category,
    pr.option_selected,
    pr.entry_percentage,
    pr.option_difficulty,
    pr.karma_risked,
    pr.karma_awarded,
    pr.prestige_change,
    pr.resolution_result,
    pr.is_correct,
    pr.created_at as predicted_at,
    pr.settled_at
  from public.predictions pr
  join public.markets m on m.id = pr.market_id
  where pr.user_id = profile_id_input
    and pr.settled_at is not null
    and (
      before_settled_at_input is null
      or pr.settled_at < before_settled_at_input
      or (
        pr.settled_at = before_settled_at_input
        and before_prediction_id_input is not null
        and pr.id < before_prediction_id_input
      )
    )
  order by pr.settled_at desc, pr.id desc
  limit greatest(1, least(coalesce(limit_count, 13), 25));
$function$;

revoke all on function public.get_public_predictor_history(
  uuid,
  timestamptz,
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.get_public_predictor_history(
  uuid,
  timestamptz,
  uuid,
  integer
) to anon, authenticated;

comment on function public.get_public_predictor_history(
  uuid,
  timestamptz,
  uuid,
  integer
) is 'Historial público con paginación por cursor. Nunca devuelve predicciones activas.';
