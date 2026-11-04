-- 004: beta capacity, archive lifecycle, atomic selective import.
-- Existing over-limit data remains untouched. Only capacity-increasing writes are rejected.
create or replace function public.receipts_room_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 104));
  if tg_op = 'INSERT' or (new.active and (not old.active or new.user_id is distinct from old.user_id)) then
    if new.active and (select count(*) from public.clients where user_id=new.user_id and active and id<>new.id)>=3 then
      raise exception 'Three active client rooms maximum. Archive a room before creating another.' using errcode='23514';
    end if;
  end if;
  if tg_op='UPDATE' and old.active and not new.active then
    update public.content_items set archived=true, updated_at=now()
      where client_id=new.id and user_id=new.user_id and not archived;
  end if;
  return new;
end $$;
drop trigger if exists receipts_room_capacity on public.clients;
create trigger receipts_room_capacity before insert or update of active,user_id on public.clients
for each row execute function public.receipts_room_guard();

create or replace function public.receipts_post_guard() returns trigger
language plpgsql set search_path=public as $$
declare owner_id uuid; is_active boolean;
begin
  -- Ownership is checked on every assignment, including archived content.
  if new.client_id is not null then
    -- Lock before checking active/ownership: room archive must not race an import.
    perform pg_advisory_xact_lock(hashtextextended(new.client_id::text, 105));
    select user_id,active into owner_id,is_active from public.clients where id=new.client_id;
    if owner_id is distinct from new.user_id then
      raise exception 'Client room does not belong to this creator.' using errcode='23503';
    end if;
    if not new.archived and not is_active then
      raise exception 'Archived client rooms cannot receive posts.' using errcode='23514';
    end if;
    if not new.archived and (tg_op='INSERT' or old.archived or new.client_id is distinct from old.client_id) then
      if (select count(*) from public.content_items where client_id=new.client_id and not archived and id<>new.id)>=1 then
        raise exception 'This room already has an active post. Open or archive it before importing another.' using errcode='23514';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists receipts_post_capacity on public.content_items;
create trigger receipts_post_capacity before insert or update of client_id,archived,user_id on public.content_items
for each row execute function public.receipts_post_guard();

-- Never directly persist a browsed Buffer candidate. This RPC performs one
-- selected import + initial immutable snapshot in the same transaction.
create or replace function public.receipts_import_selected(
  p_user_id uuid,p_client_id uuid,p_buffer_id text,p_title text,p_caption text,
  p_image text,p_platform text,p_service text,p_channel text,p_status text,
  p_due_at timestamptz,p_source_at timestamptz,p_fingerprint text,p_snapshot jsonb
) returns public.content_items language plpgsql security definer set search_path=public as $$
declare result public.content_items; v_snapshot uuid;
begin
  if not exists(select 1 from public.clients where id=p_client_id and user_id=p_user_id and active) then
    raise exception 'Active client room not found.' using errcode='23503';
  end if;
  insert into public.content_items(user_id,client_id,buffer_post_id,title,caption,image_url,platform,service,
    channel_id,buffer_status,due_at,source_created_at,current_fingerprint,status)
    values(p_user_id,p_client_id,p_buffer_id,p_title,p_caption,coalesce(p_image,''),p_platform,p_service,
      p_channel,p_status,p_due_at,p_source_at,p_fingerprint,'draft') returning * into result;
  insert into public.content_snapshots(content_item_id,user_id,version,caption,image_url,platform,service,
    channel_id,buffer_status,due_at,fingerprint,snapshot_json)
    values(result.id,p_user_id,1,p_caption,coalesce(p_image,''),p_platform,p_service,p_channel,
      p_status,p_due_at,p_fingerprint,p_snapshot) returning id into v_snapshot;
  update public.content_items set latest_snapshot_id=v_snapshot where id=result.id returning * into result;
  return result;
end $$;
revoke all on function public.receipts_import_selected(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.receipts_import_selected(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,jsonb) to service_role;

-- Diagnostic only: no automatic cleanup or silent deletion.
create or replace view public.receipts_beta_overages as
select c.user_id,count(distinct c.id) filter(where c.active) as active_rooms,
       count(distinct c.id) filter(where c.active)>3 as too_many_rooms
from public.clients c group by c.user_id;

revoke all on public.receipts_beta_overages from public, anon, authenticated;
grant select on public.receipts_beta_overages to service_role;
