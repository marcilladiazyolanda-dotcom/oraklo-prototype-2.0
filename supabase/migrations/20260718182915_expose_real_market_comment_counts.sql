-- Paso 11 · Publica el contador social real de cada mercado.
--
-- La RPC historica devolvia 0 de forma provisional. Los comentarios ya se
-- sincronizan en public.markets.comments_count mediante el trigger social, por
-- lo que la lista publica puede exponer ese agregado sin revelar datos privados.

create or replace function public.get_public_markets()
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
    coalesce(m.comments_count, 0) as comments_count,
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

revoke all on function public.get_public_markets() from public, anon, authenticated;
grant execute on function public.get_public_markets() to anon, authenticated;

comment on function public.get_public_markets() is
  'Mercados publicos con metricas reales agregadas, incluido el numero de comentarios visibles.';
