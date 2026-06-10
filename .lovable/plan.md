
# Scheduling System — Architecture Plan

Stack: TanStack Start on Cloudflare Workers + Supabase + Postmark. Per-user OAuth (not connectors) against Victoria's Google + Zoom accounts. Secrets `GOOGLE_OAUTH_CLIENT_ID/_SECRET` and `ZOOM_OAUTH_CLIENT_ID/_SECRET` are present.

Existing tables worth knowing before reading §1:
- `clients` — pipeline lead/booked/active rows. `status` enum is `lead | booked | active | delivered | complete | archived`. **There is no "Discovery Call" stage in the schema today** — confirmed in §6 and Open Question 1.
- `calendar_connections` — already has `provider`, `access_token`, `refresh_token`, `calendar_id` (Google only today). We'll extend it.
- `calendar_availability_rules` — already models weekly availability + buffer + min-notice + max-advance per user. We'll seed/extend it.
- `email_sends`, `email_templates`, `activity_log`, `scheduled_communications` — reuse for audit, copy, and the queue pattern in §7.

---

## 1. Data model

Where an existing table covers the need, we ALTER it rather than create a parallel one. Five tables are net-new.

### 1a. Extend `calendar_connections` (existing)

| Change | Reason |
|---|---|
| Add `'zoom'` to the provider enum | Single home for OAuth credentials |
| Add `token_expires_at timestamptz`, `scopes text[]`, `account_email text`, `updated_at` | Needed for refresh + UI display |
| Confirm `access_token`/`refresh_token` are server-read-only (no `TO authenticated`/`anon` SELECT) | Service role + server fns only |

RLS: owner SELECT of non-secret fields; service role full. Tokens are never sent to the browser.

### 1b. Extend `calendar_availability_rules` (existing)

Seed Victoria's weekly grid (Tue 10–15, Wed 17–19, Thu 15–19, Sat 10–14, Sun 10–14, America/New_York), with `buffer_after_minutes=15`, `min_notice_hours=8`, `max_advance_days=60`. No schema change needed unless we discover it can't represent multiple windows per day (it can via multiple rows).

### 1c. `scheduling_settings` (new — singleton per owner)

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| owner_user_id | uuid fk auth.users unique | Singleton per owner |
| timezone | text | Default `America/New_York` |
| buffer_minutes | int | Default 15 (mirrors availability rule; this is the canonical knob the UI edits) |
| min_lead_time_hours | int | Default 8 |
| lookahead_days | int | Default 60 |
| primary_calendar_id | text | Google calendar to write events to + read busy from |
| also_busy_from_calendar_ids | text[] | Optional additional read-only freebusy sources |
| owner_notification_email | text | Defaults to Victoria's account email |
| created_at, updated_at | timestamptz | |

RLS: owner SELECT/UPDATE only. Public booking pages read a tiny, safe projection (timezone, buffer, min_lead) through a server fn.

### 1d. `call_types` (new)

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| slug | text unique citext | URL segment, e.g. `discovery` |
| name | text | "Discovery Call" |
| description | text | Markdown allowed |
| duration_minutes | int | |
| color | text | Hex; used in admin + pipeline card |
| location_type | enum (`zoom`) | Reserved for future (in-person, phone) |
| pipeline_stage_on_book | text | Which stage to land the lead in — see §6 / OQ1 |
| is_active | bool default true | |
| display_order | int | |
| created_at, updated_at | | |

RLS: owner write. **Public SELECT of `is_active=true` rows allowed** so booking pages render anonymously without going through the service role for every page load.

### 1e. `call_type_fields` (new)

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| call_type_id | uuid fk cascade | |
| label | text | |
| field_type | enum (`text`,`textarea`,`email`,`date`,`dropdown`,`checkbox`) | |
| is_required | bool | |
| placeholder | text | |
| options | jsonb | Array of strings; only for `dropdown` |
| display_order | int | |
| field_key | text | Stable key for `bookings.custom_field_responses` |

Unique `(call_type_id, field_key)`. RLS mirrors parent.

System-reserved fields (always rendered, not stored in `call_type_fields`): `primary_email` (required), `couple_name_1` (required), `couple_name_2` (optional), `phone` (optional). Per-call-type fields are everything else.

### 1f. `bookings` (new)

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| call_type_id | uuid fk | |
| client_id | uuid fk clients null | Set after pipeline upsert |
| status | enum (`confirmed`,`cancelled`,`rescheduled`,`completed`,`no_show`) | No `pending` — see §3 race-resolution |
| starts_at | timestamptz | UTC instant |
| ends_at | timestamptz | UTC instant; generated or app-computed |
| timezone_snapshot | text | Studio TZ at the time of booking |
| visitor_timezone | text | What the couple saw |
| primary_email citext, couple_name_1, couple_name_2, phone | | System fields |
| custom_field_responses | jsonb | Keyed by `field_key` |
| zoom_meeting_id, zoom_join_url, zoom_password | text | |
| google_calendar_event_id, google_calendar_id | text | |
| source | enum (`public`,`manual_invite`) | |
| invite_token | uuid null | FK to `manual_invites.token` |
| cancel_token, reschedule_token | uuid unique | Sent in emails |
| cancelled_at, cancelled_by enum (`couple`,`owner`,`system`), cancellation_reason | | |
| rescheduled_from_booking_id | uuid fk null | History chain |
| created_at, updated_at | | |

Indexes: `(starts_at)`, `(status, starts_at)`, `(client_id)`, `(call_type_id, starts_at)`, unique on `cancel_token` and `reschedule_token`.

RLS:
- Owner SELECT all; owner UPDATE for cancel/status.
- No public SELECT. Confirmation page reads via SECURITY DEFINER RPC keyed by `cancel_token`.
- INSERT only through a SECURITY DEFINER server function (`create_booking`) — never via PostgREST anon.

### 1g. `booking_reminders` (new)

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| booking_id | uuid fk cascade | |
| kind | enum (`confirmation`,`reminder_24h`,`reminder_1h`,`owner_notification`,`cancelled`,`rescheduled`) | |
| send_at | timestamptz | |
| status | enum (`pending`,`sent`,`failed`,`skipped`,`cancelled`) | |
| sent_at | timestamptz | |
| postmark_message_id | text | |
| email_send_id | uuid fk email_sends | Audit link |
| attempt_count | int default 0 | |
| last_error | text | |
| created_at | | |

Unique `(booking_id, kind)` for the per-booking single-shot reminders (24h/1h/confirmation). Index `(status, send_at)` for the cron sweep.

RLS: owner SELECT; service role write.

### 1h. `manual_invites` (new)

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| token | uuid unique | URL token |
| client_id | uuid fk clients | The lead being invited |
| call_type_id | uuid fk null | Null = couple chooses, set = locked |
| prefill | jsonb | Snapshot of email/names |
| personal_note | text | Optional, included in email |
| expires_at | timestamptz | Default +14 days |
| used_at | timestamptz null | |
| used_by_booking_id | uuid fk bookings null | |
| created_by | uuid fk auth.users | |
| created_at | | |

RLS: owner write. Public read keyed by token only, via SECURITY DEFINER RPC (returns prefill + call_type only).

### 1i. Reuse, do not recreate

| Need | Use |
|---|---|
| Pipeline lead | `clients` — see §6 |
| Email audit | `email_sends` referenced from `booking_reminders.email_send_id` |
| Email copy storage | `email_templates` (seed 7 rows — §8) |
| Owner notifications | `notifications` (in-app) + email per setting |
| Activity timeline | `activity_log` |
| Future generic queue | The cron in §7 also drains `scheduled_communications` |

---

## 2. OAuth flows

Owner-only. The "Connect" cards live in `studio.settings.integrations.tsx` (route exists). Disconnect, reconnect, last-refreshed timestamp, account email shown per provider.

### 2a. Connect flow (shape identical for Google + Zoom)

```text
[Settings/Integrations] click "Connect Google"
  → GET /api/auth/google/start   (auth-gated TSS server route)
      - require admin role
      - build signed `state` = HMAC(owner_user_id, nonce, redirect_back)
      - set short-lived HttpOnly cookie holding the nonce
      - 302 to Google consent
          scopes: openid email
                  https://www.googleapis.com/auth/calendar.events
                  https://www.googleapis.com/auth/calendar.readonly
          access_type=offline, prompt=consent, include_granted_scopes=true
Google → GET /api/public/google-oauth-callback?code&state
  - verify state HMAC and cookie nonce; ensure timestamp < 10m
  - POST to token endpoint with code + CLIENT_ID + CLIENT_SECRET + redirect_uri
  - GET https://openidconnect.googleapis.com/v1/userinfo → account_email
  - UPSERT calendar_connections (provider='google', user_id=owner)
       store access_token, refresh_token, token_expires_at, scopes, account_email
  - 302 → /studio/settings/integrations?connected=google
```

Zoom mirrors this, swapping:
- Authorize: `https://zoom.us/oauth/authorize`
- Token: `https://zoom.us/oauth/token` (Basic header `client_id:client_secret`)
- Userinfo: `GET https://api.zoom.us/v2/users/me`
- Scopes: `meeting:write:meeting meeting:read:meeting user:read:user`
- Callback: `/api/public/zoom-oauth-callback`

Why `/api/public/*` for callbacks: providers can't carry our app session cookie, so route auth must be skipped at the edge. Security comes from the signed `state` + nonce cookie, not from middleware.

### 2b. Token encryption — recommendation: don't add a new secret

The Supabase service-role key is already the trust boundary for these rows: no client role has SELECT on `access_token` / `refresh_token`, only server-side code with the service role can read them, and they never appear in any API response. Adding app-layer envelope encryption with a new `INTEGRATION_ENCRYPTION_KEY` adds key-management burden (rotation, loss = unrecoverable tokens) without meaningfully improving the threat model since the same Worker would hold both the encryption key and the DB key.

**Recommend: rely on RLS + column privileges; do NOT add `INTEGRATION_ENCRYPTION_KEY`.** Optional hardening later: pgsodium or Supabase Vault for at-rest encryption — flagged in OQ.

### 2c. Token refresh

Single helper `getProviderClient(provider, ownerUserId)`:
1. SELECT row.
2. If `token_expires_at < now() + 60s`, POST provider token endpoint with `refresh_token`.
3. UPDATE row with new access_token, new expires_at, and new refresh_token if provider rotated it (Zoom always does, Google occasionally does).
4. Return a fetch wrapper that auto-retries once on `401` by forcing a refresh.

All Google/Zoom calls go through this helper. Never call providers directly.

### 2d. Disconnect

`POST /api/auth/{provider}/disconnect` (auth-gated):
- Best-effort POST to provider revoke endpoint.
- `UPDATE calendar_connections SET is_active=false, access_token=null, refresh_token=null`.
- Existing bookings keep their `zoom_meeting_id` / `google_calendar_event_id` — we don't delete upstream artifacts on disconnect.

### 2e. Failure modes

| Failure | Behavior |
|---|---|
| Refresh returns `invalid_grant` (owner revoked at provider) | Mark connection inactive, write `activity_log`, red banner in Settings, alert email to owner, **fail new bookings** with a user-safe "scheduling temporarily unavailable" message |
| Provider 5xx during booking | Retry once with backoff, then compensation per §4 |
| Refresh succeeds but next call still 401 | One more refresh + retry, then treat as `invalid_grant` |
| Zoom user hits meeting cap or daily rate | Surface specific error to owner, fail the booking with retry guidance |

---

## 3. Availability engine

### 3a. Inputs

- `call_type.duration_minutes` (D)
- `scheduling_settings` (timezone, buffer_minutes, min_lead_time_hours, lookahead_days)
- `calendar_availability_rules` rows for the owner
- `business_calendar_holidays` (table exists) — optional auto-block, see OQ
- Optional `availability_overrides` (deferred to v2 unless needed — flagged)
- Google Calendar freebusy for `primary_calendar_id` ∪ `also_busy_from_calendar_ids`
- `bookings` rows with `status IN ('confirmed')` overlapping the date range

### 3b. Algorithm

```text
function getSlots(callTypeSlug, fromDate, toDate, visitorTz):
  ct       = call_types where slug=?
  settings = scheduling_settings (singleton)
  D        = ct.duration_minutes
  step     = 15m
  buffer   = settings.buffer_minutes
  min_lead = settings.min_lead_time_hours
  horizon  = min(toDate, today + settings.lookahead_days)
  studio_tz= settings.timezone

  // 1. Walk the weekly grid in studio TZ
  candidates = []
  for day in [max(today, fromDate) .. horizon]:
    weekday = dayOfWeek(day, studio_tz)
    for rule in availability_rules where day_of_week=weekday and is_active:
      walk t from rule.start_time to rule.end_time in `step`:
        if t + D ≤ rule.end_time:
          candidates.push(localToUtc(day, t, studio_tz))

  // 2. Apply min_lead
  candidates = candidates.filter(c => c >= now() + min_lead)

  // 3. Subtract busy
  range_start = candidates[0]
  range_end   = candidates[-1] + D
  google_busy = freebusy(range_start, range_end)            // single API call
  db_busy     = SELECT (starts_at, ends_at) FROM bookings
                WHERE status='confirmed' AND ends_at > range_start
                                          AND starts_at < range_end
  busy = expandByBuffer(google_busy ∪ db_busy, buffer)

  // 4. Drop overlaps
  available = candidates.filter(c =>
                !busy.any(b => overlaps([c, c+D], b)))

  // 5. Return in UTC; UI displays in visitorTz
  return available
```

### 3c. Timezone handling

- Storage: every timestamp is `timestamptz` (UTC instant).
- Computation: availability windows are walked in **studio TZ** (Postgres `AT TIME ZONE` or Luxon).
- Display: visitor sees slots in their browser TZ, auto-detected via `Intl.DateTimeFormat().resolvedOptions().timeZone`, with a TZ picker for override. Subline: "Times shown in {visitorTz}. Studio time: America/New_York."
- DST: walking local times in studio TZ naturally produces one fewer slot on spring-forward Sunday and one extra on fall-back — correct behavior.

### 3d. Race / concurrency

Two visitors holding the same slot must not both succeed. Strategy:

1. The booking endpoint runs inside a transaction that takes a **Postgres advisory lock** keyed on `hashtext(call_type_id::text)` (narrow contention — only same-call-type bookings compete).
2. Inside the lock: re-run the per-slot availability check against `bookings` (status='confirmed') AND a live Google freebusy call for that specific window.
3. If clear, INSERT booking with `status='confirmed'`, COMMIT, then release lock.
4. If taken, return `409 SLOT_TAKEN`; UI refetches that date's slots and prompts the user to pick again.

We do NOT use a unique constraint on `starts_at` — slots are ranges, not points. The advisory-lock + re-query pattern is the correct primitive.

### 3e. Edge cases

| Case | Behavior |
|---|---|
| No slots in horizon | "No times available in the next {lookahead} days — email victoria@…" |
| Day fully blocked / holiday | Day non-clickable in calendar grid |
| Slot taken between page load and submit | 409 SLOT_TAKEN, refetch, repick |
| Visitor TZ unknown | Fall back to studio TZ with explicit label |
| DST transition day | Naturally handled by local-time walk |
| Owner connected but token revoked at Google | Booking endpoint fails fast with "temporarily unavailable" |

---

## 4. Public booking pages

### 4a. Routes

| Route | Auth | Purpose |
|---|---|---|
| `src/routes/book.$slug.tsx` | public, SSR on | Call type landing + booking |
| `src/routes/book.confirmed.$cancel_token.tsx` | public, SSR on | Confirmation, reschedule, cancel |
| `src/routes/api/public/create-booking.ts` | public TSS server route | Mutation endpoint |
| `src/routes/api/public/availability.ts` | public TSS server route | Slot fetch (could also be a server fn called from the page) |
| `src/routes/api/public/cancel-booking.ts` | public, token-gated | Cancel via emailed link |
| `src/routes/api/public/reschedule-booking.ts` | public, token-gated | Reschedule via emailed link |
| `src/routes/api/public/google-oauth-callback.ts` | public | §2 |
| `src/routes/api/public/zoom-oauth-callback.ts` | public | §2 |

`/book/$slug` loader reads the call type + fields via a public server fn that uses `supabaseAdmin` and returns a minimum-shape DTO (never raw rows). Loader runs in SSR; metadata `head()` is per-call-type.

`?invite={token}` triggers the manual-invite flow (§5/§6): server validates token, hydrates prefill, locks call type.

### 4b. Page sections (stepwise on one page)

1. **Header** — call type name, duration badge, description, "with Victoria Boustani", brand mark.
2. **Date picker** — calendar grid, days with ≥1 slot clickable.
3. **Time slots** — list for selected date, in visitor's TZ, with a "Studio time: {tz}" subline.
4. **Form** — system fields (`primary_email`*, `couple_name_1`*, `couple_name_2`, `phone`) + the call type's custom fields in `display_order`.
5. **Review & confirm** — summary block + single CTA. Loading + disabled states.
6. **Success** — redirect to `/book/confirmed/{cancel_token}`.

### 4c. Submit flow

`POST /api/public/create-booking`:

```text
Input: call_type_id, starts_at, custom_field_responses, system fields,
       invite_token?, visitor_timezone, idempotency_key (client-generated)

1. Validate input shape (Zod).
2. Idempotency: short-circuit if a booking with same idempotency_key
   exists in last 5 min → return existing.
3. Open tx; take advisory lock on call_type_id.
4. Re-validate slot per §3d.
5. If invite_token: UPDATE manual_invites SET used_at=now(),
       used_by_booking_id=? WHERE token=? AND used_at IS NULL;
   if 0 rows → ROLLBACK, return 409 INVITE_USED.
6. INSERT booking with status='confirmed' but zoom/google fields null.
   COMMIT (locks released).
7. Zoom: create meeting → UPDATE booking with zoom_*.
8. Google: insert calendar event with Zoom link in description, location
   = Zoom join URL, attendee=primary_email but sendUpdates='none'
   (we send our own branded email) → UPDATE booking with google_*.
9. Pipeline upsert (§6).
10. INSERT booking_reminders:
       ('confirmation', now()),
       ('reminder_24h', starts_at - 24h or 'skipped' if past),
       ('reminder_1h',  starts_at - 1h  or 'skipped' if past),
       ('owner_notification', now()).
11. activity_log INSERT.
12. Best-effort: invoke the reminder processor synchronously to send
    the confirmation + owner notification immediately. If it fails, the
    cron picks it up within 1 minute.
13. Return { booking_id, cancel_token, starts_at, zoom_join_url }.
```

### 4d. Confirmation page

Reads booking via SECURITY DEFINER RPC keyed on `cancel_token`. Shows:
- Summary (date/time in visitor TZ with studio TZ subline)
- Zoom join link + password
- "Add to calendar" .ics download (server-generated)
- "Reschedule" — links to `/book/{slug}?reschedule={reschedule_token}` which prefills and on submit calls `/api/public/reschedule-booking` (cancels old Zoom + Calendar, creates new, chains `rescheduled_from_booking_id`)
- "Cancel" — POSTs `/api/public/cancel-booking` with `cancel_token`

---

## 5. Owner admin UI

| Screen | Route | Notes |
|---|---|---|
| Integrations (extend existing) | `studio.settings.integrations.tsx` | Google + Zoom connect/disconnect; account_email, scopes, refreshed-at, banner if disconnected |
| Scheduling overview | `studio.settings.scheduling.tsx` (new) | Tabs: Call types, Availability, Settings |
| Call types list | tab on the above | Drag-reorder, toggle is_active, copy public URL, "New call type" |
| Call type detail | `studio.settings.scheduling.$id.tsx` | Name/slug/duration/description/color/pipeline_stage; inline custom-fields editor (add/remove/reorder/required, options for dropdown) |
| Availability | tab — `availability` | Weekly grid editor + buffer + min_lead + lookahead + timezone |
| Upcoming bookings | `studio.calls.tsx` (new top-level nav) | Filter by call type/status/date; row → drawer with details + cancel/no-show/completed actions |
| Booking detail drawer | inline on `studio.calls` | Couple info, custom field responses, Zoom + Calendar links, reminder status, linked lead |
| Pipeline manual invite | button on `studio.pipeline.sales.tsx` + `studio.clients.$id.tsx` | Modal: pick call type (or "let them choose"), expiry, personal note → INSERT `manual_invites`, send `manual_invite` email |

---

## 6. Sales pipeline tie-in

### 6a. Lead upsert at booking time

```text
if invite_token present:
    link booking.client_id to manual_invites.client_id (do not change status)
else:
    existing = SELECT clients WHERE primary_email = ?
                                AND status IN ('lead','booked','active')
                                ORDER BY created_at DESC LIMIT 1
    if existing:
        UPDATE clients SET last_contacted_at = now(),
                           inquiry_source = COALESCE(inquiry_source,
                                                    'scheduling:' || ct.slug)
        booking.client_id = existing.id
    else:
        INSERT clients (couple_name_1, couple_name_2, primary_email, phone,
                        status='lead',
                        inquiry_source='scheduling:' || ct.slug,
                        notes='Booked ' || ct.name || ' for ' ||
                              to_char(starts_at, 'YYYY-MM-DD HH24:MI'))
        booking.client_id = new.id
        activity_log INSERT (action='lead_created_from_booking')
```

### 6b. The "Discovery Call" stage problem

The `clients.status` enum today is `lead | booked | active | delivered | complete | archived`. **There is no Discovery Call stage**, so the spec's "create lead at Discovery Call stage" cannot be satisfied with the existing schema.

Three options, ranked:

1. **Add `pipeline_stage text` to `clients` (recommended)** — keep the high-level `status` for billing-relevant transitions, add a finer-grained stage column (`new_inquiry | discovery_call | proposal_sent | contract_sent | booked`) that the sales kanban renders columns from. Each `call_types` row picks which `pipeline_stage` a booking lands at (column `pipeline_stage_on_book` in §1d).
2. Extend the `client_status` enum with `discovery_call`. Simpler, but conflates with billing status and ripples into every existing query.
3. Store the stage only in `inquiry_source` text. Easiest, but no kanban grouping.

**Plan assumes option 1.** Confirmed as Open Question 1 — needs Victoria's call before slice 7.

### 6c. Pipeline card display

The lead's card on `studio.pipeline.sales.tsx` shows:
- Upcoming `bookings` rows (joined on `client_id`) with status='confirmed'
- Zoom join link
- Reschedule / Cancel buttons (owner-side cancel uses an internal endpoint, not the cancel_token)

---

## 7. Reminder cron / scheduled jobs

Today there is **zero scheduled-job infrastructure** in the project (`scheduled_communications` exists as a queue table but nothing processes it).

### 7a. Options compared

| Option | Pro | Con |
|---|---|---|
| **Supabase `pg_cron` + `pg_net` → TSS `/api/public/process-reminders`** ✅ | Already supported in Supabase; no new infra; reusable for `scheduled_communications` and future invoice reminders; auth via `apikey` header (no new secret) | 1-minute granularity (fine — ±60s on a 1h reminder is invisible) |
| External scheduler (cron-job.org) | Trivial | Adds an external dependency Victoria must maintain; failure surface outside our control |
| Cloudflare Worker cron triggers | Same runtime | Workers cron config is managed by Lovable; less obviously controllable; separate billing path |
| Process-on-request | — | Doesn't fire when nobody's visiting; rejected |

### 7b. Mechanics

```text
-- pg_cron job, every minute
SELECT cron.schedule(
  'process-scheduling-reminders',
  '* * * * *',
  $$ SELECT net.http_post(
       url   => 'https://studio.victoriaboustani.com/api/public/process-reminders',
       headers => '{"Content-Type":"application/json",
                    "apikey":"<SUPABASE_ANON_KEY>"}'::jsonb,
       body  => '{}'::jsonb
     ); $$
);

-- handler /api/public/process-reminders
WITH due AS (
  SELECT id, booking_id, kind
  FROM booking_reminders
  WHERE status='pending' AND send_at <= now()
  ORDER BY send_at
  LIMIT 50
  FOR UPDATE SKIP LOCKED
)
UPDATE booking_reminders SET status='sending' ... RETURNING *;

for each row:
  load booking + call_type + client; render template;
  Postmark send; INSERT email_sends;
  UPDATE booking_reminders SET status='sent', sent_at=now(),
                               email_send_id=?, postmark_message_id=?;
on error:
  attempt_count++; last_error=?;
  status = 'failed' if attempts ≥ 3 else 'pending' (retry next tick)
```

`FOR UPDATE SKIP LOCKED` makes concurrent ticks safe.

### 7c. Cancellation / reschedule semantics

- On cancel: `UPDATE booking_reminders SET status='cancelled' WHERE booking_id=? AND status='pending'`. Then enqueue a new `cancelled` reminder for immediate send.
- On reschedule: cancel pending reminders on the old booking, INSERT fresh `reminder_24h`/`reminder_1h` on the new booking, enqueue a `rescheduled` notification.

### 7d. Long-term value

Yes — this same processor route can dispatch over `scheduled_communications` (workflow emails — currently unprocessed) and future invoice-reminder queues. Worth designing the processor as a thin dispatcher over multiple queue tables from day one. Ship it for scheduling first, then point `scheduled_communications` at it in a follow-up.

---

## 8. Email templates

Seeded as rows in `email_templates`. Voice: SBV +10% formality (matches `payment_received`).

| Template key | Trigger | Audience |
|---|---|---|
| `booking_confirmation` | immediately on booking | couple |
| `booking_reminder_24h` | T-24h | couple |
| `booking_reminder_1h` | T-1h | couple |
| `booking_cancelled` | on cancel | couple + owner |
| `booking_rescheduled` | on reschedule | couple + owner |
| `owner_new_booking_notification` | on booking | owner (email + in-app `notifications`) |
| `manual_invite` | when owner sends invite | lead |

(Copy written together later — out of scope for this plan.)

---

## 9. Edge cases & failure modes

| Case | Behavior |
|---|---|
| Zoom API fails after booking row inserted | Compensation: DELETE booking row, release invite_token, return 503 to user with "try again" guidance. We chose this over "book without Zoom and notify owner" because a meeting with no link confuses the couple; better to fail loudly. **OQ:** confirm this preference. |
| Google Calendar fails after Zoom succeeded | Best-effort DELETE the Zoom meeting, then DELETE booking row, return 503. If Zoom delete fails, leave orphan Zoom meeting and alert owner via `activity_log` + email. |
| Reminder rows fail to insert (post-confirm) | Do NOT roll back — meeting is real. Alert owner; offer "re-enqueue reminders" button in admin. |
| Pipeline upsert fails | Same — alert owner; booking still exists, linkable manually. |
| Token expiry mid-operation | Auto-refresh + one retry per §2c. Then fail per "invalid_grant". |
| Token revoked at provider | Banner in Settings, fail new bookings with user-safe message, existing bookings unaffected (their Zoom/Calendar artifacts persist). |
| DST transition day | Walk in studio TZ — naturally one fewer / one extra slot, correct. |
| Booking race | Advisory lock + re-query per §3d → loser gets 409, repicks. |
| Visitor in unusual TZ | Browser-detected TZ + manual override; storage is UTC. |
| Bot / abuse | (a) rate-limit `/api/public/create-booking` per IP via an in-memory token bucket on the Worker — note: per-Worker-instance not global, acceptable for v1; (b) honeypot field hidden in the form; (c) Cloudflare Turnstile gated behind a flag, off by default until abuse is observed (avoids friction). **OQ:** confirm Turnstile preference. |
| Couple double-submits | Idempotency key per §4c step 2. |
| Owner cancels their Google calendar account email | `invalid_grant` path — same handling. |

---

## 10. Recommended build order

Each slice ends with the system runnable and demoable.

| # | Slice | Effort | Acceptance | Why this position |
|---|---|---|---|---|
| **1** | **OAuth foundation** | M | Victoria sees both Google + Zoom as "Connected" with her account emails; force a token refresh and confirm it succeeds; disconnect works | Unblocks everything; surfaces provider-config friction early; clean acceptance criteria |
| 2 | Schema + scheduling settings + call types + custom fields + admin CRUD | M | Migrations applied; owner can create "Discovery", "Engagement Consult", "Planning Meeting" with custom fields; public URLs reserved but pages 404 still | Foundation for §3 and §4 |
| 3 | Availability engine + slot API + admin availability editor | M | `GET /api/public/availability?slug=discovery&from=&to=` returns correct slots given Victoria's grid; admin can edit the weekly grid + buffer/min_lead | Pure compute slice — testable independently |
| 4 | Public booking page (rendered, submits, creates booking row only — no Zoom/Calendar yet) | L | Couple can land on `/book/discovery`, pick a slot, fill the form, see success page; booking row exists with status='confirmed' but zoom/google fields null; race-safety verified | First user-visible milestone |
| 5 | Zoom + Google Calendar on submit, with full compensation | L | Real Zoom meeting created; real Google event on Victoria's calendar with Zoom link; cancellation tested; compensation on Zoom-fail and Calendar-fail tested | Touches both providers + transactional cleanup |
| 6 | Reminder cron + email templates + confirmation/owner-notification immediate sends | M | pg_cron + processor route in place; confirmation arrives within seconds; 24h + 1h reminders fire (verified by setting send_at into the past in test data); owner gets notified | Closes the email loop; reusable infra unlocked |
| 7 | Pipeline tie-in (after Victoria confirms OQ1: stage column) + bookings list in studio + cancel/reschedule via emailed tokens | M | New booking creates `clients` lead at chosen `pipeline_stage`; existing-email booking links to existing lead; cancel + reschedule via couple's emailed links work end-to-end | Last; depends on stage-model decision |

**Recommended first tonight: Slice 1.** Medium effort, isolated, and surfaces any provider-side configuration mismatches (redirect URIs, scopes, account-tier limits) before they block downstream slices. Quick wins overall: 1, 3. Heavy lifts: 4, 5, 6.

---

## Open questions before we start

1. **Pipeline stage model.** Add `pipeline_stage text` to `clients` (recommended) vs extend the `client_status` enum vs leave it in `inquiry_source`? This blocks slice 7 only — we can start without resolving it.
2. **Confirm token-encryption stance.** Plan recommends RLS + column privileges only, no new `INTEGRATION_ENCRYPTION_KEY`. Confirm acceptable, or add app-layer envelope encryption.
3. **Zoom-fail policy.** Hard-fail the booking (plan default) vs accept the booking and tell the couple "Zoom link to follow"?
4. **Cloudflare Turnstile** on the public booking page now, or wait until abuse is observed?
5. **Slot interval.** 15-minute increments (plan default) or 30?
6. **Lookahead window.** 60 days (plan default), or different?
7. **Holidays.** Use existing `business_calendar_holidays` to auto-block availability? (Recommend yes.)
8. **One-off availability overrides** (e.g. "block next Thursday", "open this Saturday extra") — v1 or v2? Plan defers to v2.
9. **Reschedule** — couple-facing (plan v1) or owner-only?
10. **Booking page chrome.** Studio brand header/footer, or stripped Calendly-style standalone page? Recommend standalone with brand mark + one footer line.
11. **Domain for public URLs.** `studio.victoriaboustani.com/book/...` (works today) vs dedicated `book.victoriaboustani.com`. Affects only OAuth redirect URI list — Google accepts multiple.
12. **Couple_name_2 required?** Assumed optional. Some couples book solo for discovery.
13. **Phone required on the form?** Assumed optional system field.
14. **Owner notification channel.** Email + in-app `notifications` row (recommended), or one of the two?
15. **Time format.** 12-hour with am/pm (assumed) or 24-hour?
