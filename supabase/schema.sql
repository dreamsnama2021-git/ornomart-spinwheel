-- Ornomart Spin Wheel - Supabase schema
-- Run this once in the Supabase SQL Editor (for a new project).

-- ============ Tables ============
create table public.spin_coupons (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(trim(label)) > 0),  -- short text drawn on the wheel
  details text not null default '',                     -- full offer text shown to the winner
  category text not null default '',                    -- groups coupons in the admin dashboard
  code text not null default '',
  color text not null default '#0047ab',
  weight integer not null default 10 check (weight >= 0),
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.spin_settings (
  id integer primary key default 1 check (id = 1),
  one_spin_per_mobile boolean not null default true,
  next_spin_coupon_id uuid references public.spin_coupons(id) on delete set null,
  valid_until date  -- last day coupons are valid / spins allowed (India time); null = no end date
);

create table public.spin_assignments (
  mobile text primary key check (mobile ~ '^[0-9]{10}$'),
  coupon_id uuid not null references public.spin_coupons(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.spin_entries (
  id bigint generated always as identity primary key,
  name text not null,
  mobile text not null,
  email text,
  city text,
  coupon_id uuid references public.spin_coupons(id) on delete set null,
  coupon_label text,
  coupon_details text,
  coupon_code text,
  reason text,
  created_at timestamptz not null default now()
);
create index spin_entries_mobile_idx on public.spin_entries (mobile);
create index spin_entries_created_idx on public.spin_entries (created_at desc);
create index spin_assignments_coupon_idx on public.spin_assignments (coupon_id);
create index spin_settings_next_idx on public.spin_settings (next_spin_coupon_id);
create index spin_entries_coupon_idx on public.spin_entries (coupon_id);

create table public.spin_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ============ RLS ============
alter table public.spin_coupons enable row level security;
alter table public.spin_settings enable row level security;
alter table public.spin_assignments enable row level security;
alter table public.spin_entries enable row level security;
alter table public.spin_admins enable row level security;

create or replace function public.spin_is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.spin_admins where user_id = (select auth.uid()));
$$;

create policy "admin all" on public.spin_coupons for all to authenticated
  using ((select public.spin_is_admin())) with check ((select public.spin_is_admin()));
create policy "admin all" on public.spin_settings for all to authenticated
  using ((select public.spin_is_admin())) with check ((select public.spin_is_admin()));
create policy "admin all" on public.spin_assignments for all to authenticated
  using ((select public.spin_is_admin())) with check ((select public.spin_is_admin()));
create policy "admin all" on public.spin_entries for all to authenticated
  using ((select public.spin_is_admin())) with check ((select public.spin_is_admin()));
create policy "admin read self" on public.spin_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- ============ Public functions (game page) ============
-- Wheel segments: label + color only (no coupon codes)
create or replace function public.spin_get_wheel()
returns table (id uuid, label text, color text)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.label, c.color from public.spin_coupons c order by c.sort, c.created_at;
$$;

-- On form submit: can this mobile number play?
create or replace function public.spin_can_play(p_mobile text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not coalesce((select one_spin_per_mobile from public.spin_settings where id = 1), true)
      or not exists (select 1 from public.spin_entries where mobile = right(regexp_replace(p_mobile, '\D', '', 'g'), 10));
$$;

-- Spin: the coupon is decided on the server
-- Priority: 1) mobile assignment  2) next-spin override  3) weighted random
create or replace function public.spin_play(p_name text, p_mobile text, p_email text default null, p_city text default null)
returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_mobile text := right(regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g'), 10);
  v_settings public.spin_settings;
  v_coupon public.spin_coupons;
  v_reason text;
  v_total integer;
  v_r numeric;
begin
  if length(trim(coalesce(p_name, ''))) = 0 or length(p_name) > 100 then
    raise exception 'invalid_name';
  end if;
  if v_mobile !~ '^[0-9]{10}$' then
    raise exception 'invalid_mobile';
  end if;

  -- Lock the settings row so two simultaneous spins cannot both take the "next spin" coupon
  select * into v_settings from public.spin_settings where id = 1 for update;

  -- No new spins after the validity date (India time)
  if v_settings.valid_until is not null and (now() at time zone 'Asia/Kolkata')::date > v_settings.valid_until then
    raise exception 'campaign_ended';
  end if;

  if coalesce(v_settings.one_spin_per_mobile, true)
     and exists (select 1 from public.spin_entries where mobile = v_mobile) then
    raise exception 'already_played';
  end if;

  -- 1) specific mobile assignment
  select c.* into v_coupon from public.spin_assignments a
    join public.spin_coupons c on c.id = a.coupon_id where a.mobile = v_mobile;
  if found then
    v_reason := 'assigned';
  end if;

  -- 2) next spin override
  if v_reason is null and v_settings.next_spin_coupon_id is not null then
    select * into v_coupon from public.spin_coupons where id = v_settings.next_spin_coupon_id;
    if found then
      v_reason := 'next-spin';
      update public.spin_settings set next_spin_coupon_id = null where id = 1;
    end if;
  end if;

  -- 3) weighted random
  if v_reason is null then
    select coalesce(sum(weight), 0) into v_total from public.spin_coupons where weight > 0;
    if v_total > 0 then
      v_r := random() * v_total;
      select c.* into v_coupon from (
        select *, sum(weight) over (order by sort, created_at, id) as cum
        from public.spin_coupons where weight > 0
      ) c where c.cum > v_r order by c.cum limit 1;
    else
      select * into v_coupon from public.spin_coupons order by random() limit 1;
    end if;
    v_reason := 'weighted';
  end if;

  if v_coupon.id is null then
    raise exception 'no_coupons';
  end if;

  insert into public.spin_entries (name, mobile, email, city, coupon_id, coupon_label, coupon_details, coupon_code, reason)
  values (left(trim(p_name), 100), v_mobile, nullif(left(trim(coalesce(p_email, '')), 200), ''),
          nullif(left(trim(coalesce(p_city, '')), 100), ''), v_coupon.id, v_coupon.label,
          nullif(v_coupon.details, ''), v_coupon.code, v_reason);

  return json_build_object('id', v_coupon.id, 'label', v_coupon.label, 'details', v_coupon.details, 'code', v_coupon.code);
end;
$$;

-- Returning user: latest coupon for a mobile number (label + code only, no personal data)
create or replace function public.spin_my_coupon(p_mobile text)
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object('label', e.coupon_label, 'details', e.coupon_details, 'code', e.coupon_code, 'won_at', e.created_at)
  from public.spin_entries e
  where e.mobile = right(regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g'), 10)
  order by e.created_at desc
  limit 1;
$$;

-- Public campaign info for the game page
create or replace function public.spin_public_info()
returns json
language sql stable security definer set search_path = ''
as $
  select json_build_object(
    'valid_until', s.valid_until,
    'ended', s.valid_until is not null and (now() at time zone 'Asia/Kolkata')::date > s.valid_until
  )
  from public.spin_settings s where s.id = 1;
$;
revoke all on function public.spin_public_info() from public;
grant execute on function public.spin_public_info() to anon, authenticated;

revoke all on function public.spin_my_coupon(text) from public;
grant execute on function public.spin_my_coupon(text) to anon, authenticated;

revoke all on function public.spin_is_admin() from public, anon;
revoke all on function public.spin_get_wheel() from public;
revoke all on function public.spin_can_play(text) from public;
revoke all on function public.spin_play(text, text, text, text) from public;
grant execute on function public.spin_is_admin() to authenticated;
grant execute on function public.spin_get_wheel() to anon, authenticated;
grant execute on function public.spin_can_play(text) to anon, authenticated;
grant execute on function public.spin_play(text, text, text, text) to anon, authenticated;

-- ============ Default data ============
insert into public.spin_settings (id, valid_until) values (1, date '2026-10-20');
insert into public.spin_coupons (category, label, details, code, color, weight, sort) values
  ('Category 1', '15% OFF Category 1',     '15% off on Category 1 Jewellery',         'CAT1-15',    '#0a3283', 10, 1),
  ('Category 1', '10% OFF MRP Category 1', '10% off on MRP for Category 1 Jewellery', 'CAT1-MRP10', '#ffffff', 10, 2),
  ('Category 2', '10% OFF Category 2',     '10% off on Category 2 Jewellery',         'CAT2-10',    '#0066cc', 10, 3),
  ('Category 2', '5% OFF MRP Category 2',  '5% off on MRP for Category 2 Jewellery',  'CAT2-MRP5',  '#eaf1fc', 10, 4),
  ('Category 3', '5% OFF Category 3',      '5% off on Category 3 Jewellery',          'CAT3-5',     '#0026b5', 10, 5),
  ('Category 3', '2% OFF MRP Category 3',  '2% off on MRP for Category 3 Jewellery',  'CAT3-MRP2',  '#ffffff', 10, 6);

-- ============ Make an admin ============
-- First create the admin account in Supabase dashboard > Authentication > Users > Add user, then:
-- insert into public.spin_admins (user_id) select id from auth.users where email = 'ADMIN_EMAIL_HERE';
