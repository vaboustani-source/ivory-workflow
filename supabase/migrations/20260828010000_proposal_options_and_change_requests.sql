-- Proposal options + client change requests.
-- options: jsonb array of { key, name, description?, line_items: [{label, amount}], subtotal?, discount?, total }
-- Clients accept via accept_proposal() (security definer) — direct UPDATE was never
-- allowed by RLS for client users, so acceptance now goes through the RPC.
-- (Already applied to production via MCP on 2026-08-28; kept here for history.)

alter table public.proposals
  add column if not exists options jsonb,
  add column if not exists selected_option text,
  add column if not exists change_request text,
  add column if not exists change_requested_at timestamptz;

create or replace function public.accept_proposal(p_proposal_id uuid, p_option_key text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prop proposals%rowtype;
  v_opt jsonb;
  v_couple text;
begin
  select * into v_prop from proposals where id = p_proposal_id;
  if not found then
    raise exception 'Proposal not found.';
  end if;
  if not is_client_of(auth.uid(), v_prop.client_id) then
    raise exception 'Not allowed.';
  end if;
  if v_prop.status <> 'sent' then
    raise exception 'This proposal is not open for acceptance.';
  end if;
  if v_prop.valid_until is not null and v_prop.valid_until < current_date then
    raise exception 'This proposal has expired — please request an updated one.';
  end if;

  if v_prop.options is not null
     and jsonb_typeof(v_prop.options) = 'array'
     and jsonb_array_length(v_prop.options) > 0 then
    if p_option_key is null then
      raise exception 'Please choose an option first.';
    end if;
    select opt into v_opt
    from jsonb_array_elements(v_prop.options) opt
    where opt->>'key' = p_option_key;
    if v_opt is null then
      raise exception 'Unknown option.';
    end if;
    -- Promote the chosen option into the top-level columns so everything
    -- downstream (studio financials, pipeline) sees the agreed numbers.
    update proposals set
      status = 'accepted',
      accepted_at = now(),
      selected_option = p_option_key,
      line_items = coalesce(v_opt->'line_items', line_items),
      subtotal = coalesce((v_opt->>'subtotal')::numeric, (v_opt->>'total')::numeric, subtotal),
      discount = coalesce((v_opt->>'discount')::numeric, 0),
      total = coalesce((v_opt->>'total')::numeric, total)
    where id = p_proposal_id;
  else
    update proposals set status = 'accepted', accepted_at = now()
    where id = p_proposal_id;
  end if;

  select couple_name_1 || coalesce(' & ' || couple_name_2, '') into v_couple
  from clients where id = v_prop.client_id;

  insert into notifications (user_id, kind, title, body, link_to)
  select distinct u.uid,
    'proposal_accepted',
    'Proposal accepted',
    v_couple || case
      when v_opt is not null then ' accepted "' || coalesce(v_opt->>'name', p_option_key) || '" — $' || coalesce(v_opt->>'total', '')
      else ' accepted their proposal'
    end,
    '/studio/clients/' || v_prop.client_id || '?tab=documents'
  from (
    select ur.user_id as uid from user_roles ur where ur.role = 'owner'
    union
    select c.manager_id from clients c where c.id = v_prop.client_id and c.manager_id is not null
  ) u
  where u.uid is not null;
end;
$$;

create or replace function public.request_proposal_change(p_proposal_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prop proposals%rowtype;
  v_note text;
  v_couple text;
begin
  select * into v_prop from proposals where id = p_proposal_id;
  if not found then
    raise exception 'Proposal not found.';
  end if;
  if not is_client_of(auth.uid(), v_prop.client_id) then
    raise exception 'Not allowed.';
  end if;
  if v_prop.status not in ('sent') then
    raise exception 'This proposal is not open for changes.';
  end if;

  v_note := trim(coalesce(p_note, ''));
  if v_note = '' then
    raise exception 'Please tell us what you would like to change.';
  end if;
  if length(v_note) > 2000 then
    raise exception 'Please keep your request under 2000 characters.';
  end if;

  update proposals set
    change_request = v_note,
    change_requested_at = now()
  where id = p_proposal_id;

  select couple_name_1 || coalesce(' & ' || couple_name_2, '') into v_couple
  from clients where id = v_prop.client_id;

  insert into notifications (user_id, kind, title, body, link_to)
  select distinct u.uid,
    'proposal_change_request',
    'Proposal change requested',
    v_couple || ': "' || left(v_note, 180) || case when length(v_note) > 180 then '…"' else '"' end,
    '/studio/clients/' || v_prop.client_id || '?tab=documents'
  from (
    select ur.user_id as uid from user_roles ur where ur.role = 'owner'
    union
    select c.manager_id from clients c where c.id = v_prop.client_id and c.manager_id is not null
  ) u
  where u.uid is not null;
end;
$$;

revoke all on function public.accept_proposal(uuid, text) from public, anon;
revoke all on function public.request_proposal_change(uuid, text) from public, anon;
grant execute on function public.accept_proposal(uuid, text) to authenticated;
grant execute on function public.request_proposal_change(uuid, text) to authenticated;
