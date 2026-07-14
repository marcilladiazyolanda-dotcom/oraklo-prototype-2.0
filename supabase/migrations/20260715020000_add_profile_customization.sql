-- ORAKLO · Paso 10B: personalización segura del perfil
--
-- El perfil sigue siendo un currículum predictivo. Estos campos permiten
-- personalizar su presentación sin dar acceso directo de escritura a profiles.

alter table public.profiles
  add column if not exists bio text not null default '',
  add column if not exists favorite_category text,
  add column if not exists avatar_key text not null default 'oracle',
  add column if not exists profile_theme text not null default 'aurora';

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_bio_length_check'
  ) then
    alter table public.profiles
      add constraint profiles_bio_length_check
      check (char_length(bio) <= 180);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_avatar_key_check'
  ) then
    alter table public.profiles
      add constraint profiles_avatar_key_check
      check (avatar_key in ('oracle', 'spark', 'hex', 'pulse', 'delta'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_theme_check'
  ) then
    alter table public.profiles
      add constraint profiles_theme_check
      check (profile_theme in ('aurora', 'violet', 'solar', 'ocean', 'emerald'));
  end if;
end
$migration$;

-- Evita usernames duplicados incluso si solo cambia el uso de mayúsculas.
create unique index if not exists profiles_username_lower_unique_idx
  on public.profiles (lower(username));

-- Proyección pública limitada a los campos visuales. No devuelve Karma ni
-- ningún dato de autenticación.
create or replace function public.get_public_predictor_customization(
  profile_id_input uuid
)
returns table (
  id uuid,
  bio text,
  favorite_category text,
  avatar_key text,
  profile_theme text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p.id,
    p.bio,
    p.favorite_category,
    p.avatar_key,
    p.profile_theme
  from public.profiles p
  where p.id = profile_id_input;
$function$;

revoke all on function public.get_public_predictor_customization(uuid)
  from public, anon, authenticated;
grant execute on function public.get_public_predictor_customization(uuid)
  to anon, authenticated;

comment on function public.get_public_predictor_customization(uuid) is
  'Devuelve únicamente la personalización pública de un perfil.';

-- Edición autenticada y limitada siempre al perfil propio.
create or replace function public.update_my_public_profile(
  username_input text,
  bio_input text default '',
  favorite_category_input text default null,
  avatar_key_input text default 'oracle',
  profile_theme_input text default 'aurora'
)
returns table (
  id uuid,
  username text,
  bio text,
  favorite_category text,
  avatar_key text,
  profile_theme text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  clean_username text := btrim(coalesce(username_input, ''));
  clean_bio text := btrim(coalesce(bio_input, ''));
  clean_category text := nullif(btrim(coalesce(favorite_category_input, '')), '');
  clean_avatar text := lower(btrim(coalesce(avatar_key_input, '')));
  clean_theme text := lower(btrim(coalesce(profile_theme_input, '')));
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED'
      using errcode = '28000';
  end if;

  if clean_username <> '' and left(clean_username, 1) <> '@' then
    clean_username := '@' || clean_username;
  end if;

  if clean_username !~ '^@[A-Za-z0-9._]{3,24}$' then
    raise exception 'INVALID_USERNAME'
      using errcode = '22023';
  end if;

  if char_length(clean_bio) > 180 then
    raise exception 'INVALID_BIO'
      using errcode = '22023';
  end if;

  if clean_category is not null then
    select m.category
    into clean_category
    from public.markets m
    where lower(m.category) = lower(clean_category)
    order by m.category
    limit 1;

    if not found then
      raise exception 'INVALID_CATEGORY'
        using errcode = '22023';
    end if;
  end if;

  if clean_avatar <> all (array['oracle', 'spark', 'hex', 'pulse', 'delta']) then
    raise exception 'INVALID_AVATAR'
      using errcode = '22023';
  end if;

  if clean_theme <> all (array['aurora', 'violet', 'solar', 'ocean', 'emerald']) then
    raise exception 'INVALID_THEME'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.profiles other_profile
    where lower(other_profile.username) = lower(clean_username)
      and other_profile.id <> current_user_id
  ) then
    raise exception 'USERNAME_TAKEN'
      using errcode = '23505';
  end if;

  return query
  update public.profiles p
  set
    username = clean_username,
    bio = clean_bio,
    favorite_category = clean_category,
    avatar_key = clean_avatar,
    profile_theme = clean_theme,
    updated_at = now()
  where p.id = current_user_id
  returning
    p.id,
    p.username,
    p.bio,
    p.favorite_category,
    p.avatar_key,
    p.profile_theme;

  if not found then
    raise exception 'PROFILE_NOT_FOUND'
      using errcode = 'P0001';
  end if;
end;
$function$;

revoke all on function public.update_my_public_profile(
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.update_my_public_profile(
  text,
  text,
  text,
  text,
  text
) to authenticated;

comment on function public.update_my_public_profile(
  text,
  text,
  text,
  text,
  text
) is 'Actualiza solo el perfil público del usuario autenticado con validación estricta.';
