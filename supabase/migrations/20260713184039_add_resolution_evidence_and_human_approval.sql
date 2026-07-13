-- ORAKLO · Evidencia estructurada y aprobación humana de resoluciones
-- La IA solo propone. Esta migración conserva resolve_market como motor atómico
-- y añade un envoltorio privado que exige fuentes revisadas.

alter table public.markets
  add column if not exists resolution_sources jsonb not null default '[]'::jsonb,
  add column if not exists resolution_reviewed_by uuid,
  add column if not exists resolution_ai_model text,
  add column if not exists resolution_ai_generated_at timestamptz;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.markets'::regclass
      and conname = 'markets_resolution_sources_array_check'
  ) then
    alter table public.markets
      add constraint markets_resolution_sources_array_check
      check (jsonb_typeof(resolution_sources) = 'array');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.markets'::regclass
      and conname = 'markets_resolution_reviewed_by_fkey'
  ) then
    alter table public.markets
      add constraint markets_resolution_reviewed_by_fkey
      foreign key (resolution_reviewed_by)
      references public.profiles(id)
      on delete set null;
  end if;
end
$migration$;

-- Conserva como fuentes estructuradas las dos fuentes oficiales usadas en la
-- primera resolución real de Oraklo.
update public.markets
set resolution_sources = jsonb_build_array(
  jsonb_build_object(
    'title', 'Rockstar Games · GTA VI is now set to launch November 19, 2026',
    'url', 'https://www.rockstargames.com/newswire/article/ak3ak31a49a221/grand-theft-auto-vi-is-now-set-to-launch-november-19-2026',
    'cited_text', 'Rockstar Games fijó oficialmente el lanzamiento para el 19 de noviembre de 2026.'
  ),
  jsonb_build_object(
    'title', 'Take-Two · Rockstar Games Announces Pre-Orders for Grand Theft Auto VI',
    'url', 'https://www.take2games.com/ir/news/rockstar-games-announces-pre-orders-grand-theft-auto-vi',
    'cited_text', 'Take-Two anunció las preventas y reiteró el lanzamiento para el 19 de noviembre de 2026.'
  )
)
where id = 'gta-vi-retraso'
  and resolution_result = 'No'
  and resolution_sources = '[]'::jsonb;

create or replace function public.resolve_market_with_evidence(
  market_id_input text,
  result_input text,
  resolution_note_input text,
  resolution_sources_input jsonb,
  reviewed_by_input uuid,
  ai_model_input text default null,
  ai_generated_at_input timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_item jsonb;
  normalized_sources jsonb := '[]'::jsonb;
  resolution_summary jsonb;
begin
  if reviewed_by_input is null
     or not exists (
       select 1
       from public.profiles
       where id = reviewed_by_input
     ) then
    raise exception 'INVALID_REVIEWER'
      using errcode = '22023';
  end if;

  if resolution_note_input is null
     or length(trim(resolution_note_input)) < 10
     or length(trim(resolution_note_input)) > 4000 then
    raise exception 'INVALID_RESOLUTION_NOTE'
      using errcode = '22023';
  end if;

  if resolution_sources_input is null
     or jsonb_typeof(resolution_sources_input) <> 'array'
     or jsonb_array_length(resolution_sources_input) < 1
     or jsonb_array_length(resolution_sources_input) > 12 then
    raise exception 'INVALID_RESOLUTION_SOURCES'
      using errcode = '22023';
  end if;

  for source_item in
    select value
    from jsonb_array_elements(resolution_sources_input)
  loop
    if jsonb_typeof(source_item) <> 'object'
       or length(trim(coalesce(source_item ->> 'title', ''))) < 2
       or length(trim(coalesce(source_item ->> 'title', ''))) > 200
       or length(trim(coalesce(source_item ->> 'url', ''))) > 2048
       or trim(coalesce(source_item ->> 'url', '')) !~ '^https://'
       or length(coalesce(source_item ->> 'cited_text', '')) > 1000 then
      raise exception 'INVALID_RESOLUTION_SOURCE'
        using errcode = '22023';
    end if;

    normalized_sources := normalized_sources || jsonb_build_array(
      jsonb_build_object(
        'title', trim(source_item ->> 'title'),
        'url', trim(source_item ->> 'url'),
        'cited_text', left(trim(coalesce(source_item ->> 'cited_text', '')), 1000)
      )
    );
  end loop;

  -- resolve_market mantiene el bloqueo, liquidación y reparto dentro de esta
  -- misma transacción. Si cualquier paso falla, no queda una resolución parcial.
  resolution_summary := public.resolve_market(
    market_id_input,
    result_input,
    trim(resolution_note_input)
  );

  update public.markets
  set
    resolution_sources = normalized_sources,
    resolution_reviewed_by = reviewed_by_input,
    resolution_ai_model = nullif(left(trim(coalesce(ai_model_input, '')), 100), ''),
    resolution_ai_generated_at = ai_generated_at_input
  where id = market_id_input;

  return resolution_summary || jsonb_build_object(
    'resolution_sources', normalized_sources,
    'reviewed_by', reviewed_by_input,
    'human_approved', true
  );
end;
$function$;

revoke all on function public.resolve_market_with_evidence(
  text, text, text, jsonb, uuid, text, timestamptz
) from public;
revoke all on function public.resolve_market_with_evidence(
  text, text, text, jsonb, uuid, text, timestamptz
) from anon;
revoke all on function public.resolve_market_with_evidence(
  text, text, text, jsonb, uuid, text, timestamptz
) from authenticated;
grant execute on function public.resolve_market_with_evidence(
  text, text, text, jsonb, uuid, text, timestamptz
) to postgres, service_role;

-- La firma de salida cambia para añadir fuentes. Se recrean ambas RPC públicas
-- dentro de la misma migración para que nunca queden desincronizadas.
drop function if exists public.get_public_market_by_id(text);
drop function if exists public.get_public_markets();

create function public.get_public_markets()
returns table (
  id text,
  question text,
  category text,
  status text,
  yes_percent integer,
  no_percent integer,
  difficulty text,
  karma_total integer,
  participants_count integer,
  comments_count integer,
  close_label text,
  closes_at timestamptz,
  description text,
  resolution_source text,
  yes_criteria text,
  no_criteria text,
  edge_case text,
  highlighted boolean,
  popularity integer,
  created_at timestamptz,
  actual_predictions_count integer,
  actual_yes_count integer,
  actual_no_count integer,
  resolution_result text,
  resolution_note text,
  resolved_at timestamptz,
  resolution_sources jsonb,
  resolution_ai_model text,
  resolution_ai_generated_at timestamptz
)
language sql
security definer
set search_path = ''
as $function$
  with stats as (
    select
      market_id,
      count(*)::integer as total_predictions,
      count(*) filter (where option_selected = 'Sí')::integer as yes_count,
      count(*) filter (where option_selected = 'No')::integer as no_count,
      coalesce(sum(karma_risked), 0)::integer as total_karma
    from public.predictions
    group by market_id
  )
  select
    m.id,
    m.question,
    m.category,
    case
      when m.status = 'Abierto'
       and m.closes_at is not null
       and m.closes_at <= now()
        then 'Cerrado'
      else m.status
    end as status,
    case
      when coalesce(s.total_predictions, 0) = 0 then 50
      else round((s.yes_count::numeric * 100) / s.total_predictions)::integer
    end as yes_percent,
    case
      when coalesce(s.total_predictions, 0) = 0 then 50
      else 100 - round((s.yes_count::numeric * 100) / s.total_predictions)::integer
    end as no_percent,
    m.difficulty,
    coalesce(s.total_karma, 0) as karma_total,
    coalesce(s.total_predictions, 0) as participants_count,
    0::integer as comments_count,
    case
      when m.status = 'Resuelto' then 'Resuelto'
      when m.status = 'Cerrado'
        or (
          m.status = 'Abierto'
          and m.closes_at is not null
          and m.closes_at <= now()
        ) then 'Pendiente de resolución'
      else m.close_label
    end as close_label,
    m.closes_at,
    m.description,
    m.resolution_source,
    m.yes_criteria,
    m.no_criteria,
    m.edge_case,
    m.highlighted,
    m.popularity,
    m.created_at,
    coalesce(s.total_predictions, 0) as actual_predictions_count,
    coalesce(s.yes_count, 0) as actual_yes_count,
    coalesce(s.no_count, 0) as actual_no_count,
    m.resolution_result,
    m.resolution_note,
    m.resolved_at,
    coalesce(m.resolution_sources, '[]'::jsonb) as resolution_sources,
    m.resolution_ai_model,
    m.resolution_ai_generated_at
  from public.markets m
  left join stats s on s.market_id = m.id
  order by m.highlighted desc, m.popularity desc, m.created_at desc;
$function$;

create function public.get_public_market_by_id(market_id_input text)
returns table (
  id text,
  question text,
  category text,
  status text,
  yes_percent integer,
  no_percent integer,
  difficulty text,
  karma_total integer,
  participants_count integer,
  comments_count integer,
  close_label text,
  closes_at timestamptz,
  description text,
  resolution_source text,
  yes_criteria text,
  no_criteria text,
  edge_case text,
  highlighted boolean,
  popularity integer,
  created_at timestamptz,
  actual_predictions_count integer,
  actual_yes_count integer,
  actual_no_count integer,
  resolution_result text,
  resolution_note text,
  resolved_at timestamptz,
  resolution_sources jsonb,
  resolution_ai_model text,
  resolution_ai_generated_at timestamptz
)
language sql
security definer
set search_path = ''
as $function$
  select *
  from public.get_public_markets() gm
  where gm.id = market_id_input;
$function$;

revoke all on function public.get_public_markets() from public;
revoke all on function public.get_public_markets() from anon;
revoke all on function public.get_public_markets() from authenticated;
grant execute on function public.get_public_markets() to anon, authenticated;

revoke all on function public.get_public_market_by_id(text) from public;
revoke all on function public.get_public_market_by_id(text) from anon;
revoke all on function public.get_public_market_by_id(text) from authenticated;
grant execute on function public.get_public_market_by_id(text) to anon, authenticated;

comment on column public.markets.resolution_sources is
  'Fuentes públicas aprobadas por una persona antes de resolver el mercado.';
comment on function public.resolve_market_with_evidence(
  text, text, text, jsonb, uuid, text, timestamptz
) is
  'Resolución atómica con fuentes revisadas. Solo para backend de servicio.';
