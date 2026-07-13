create index if not exists markets_resolution_reviewed_by_idx
  on public.markets (resolution_reviewed_by)
  where resolution_reviewed_by is not null;
