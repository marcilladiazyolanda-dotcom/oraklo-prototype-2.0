-- ORAKLO · Reparación de estados heredados de mercados pendientes
-- Un mercado del prototipo conservaba la etiqueta visual "Resuelto" aunque
-- nunca se había liquidado. Se devuelve a Cerrado sin tocar predicciones ni
-- saldos y se impide que vuelva a existir esa combinación incoherente.

update public.markets
set
  status = 'Cerrado',
  close_label = 'Pendiente de resolución'
where status in ('Resuelto', 'Resolved')
  and resolution_result is null
  and resolved_at is null
  and closes_at is not null
  and closes_at <= now();

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.markets'::regclass
      and conname = 'markets_resolved_state_consistency_check'
  ) then
    alter table public.markets
      add constraint markets_resolved_state_consistency_check
      check (
        status not in ('Resuelto', 'Resolved')
        or (resolution_result is not null and resolved_at is not null)
      );
  end if;
end
$migration$;

comment on constraint markets_resolved_state_consistency_check
on public.markets is
  'Un mercado solo puede figurar como resuelto cuando tiene resultado y fecha de resolución.';
