
# Contractor W-9 / 1099 Collection — Plan

## STEP 1 — Recon findings

### 1. `contractors` table (current columns)
`id, full_name, email, phone, roles[], homebase_address, homebase_lat, homebase_lng, rate_notes, preferred_min_hourly_rate, preferred_max_hourly_rate, instagram, portfolio_url, bio, is_active, notes, jobs_count, last_worked_with_at, created_at, updated_at`.

**Nothing tax-related exists.** No `w9_*`, no `tax_id`, no `business_type`, no mailing address (only homebase coordinates), no `legal_name`.

### 2. How contractor pay is recorded — IMPORTANT GAP
There is **no explicit "contractor was paid" event** in this codebase. The closest things:

- **`wedding_team`** (the canonical crew assignment table) — columns: `id, client_id, contractor_id, role, agreed_hourly_rate, agreed_hours, agreed_total (int cents), contract_id, created_at`. Used in `src/lib/financials.ts` (`fetchClientCrewAndLineItems`) as the source of truth for crew cost.
- **`contractor_service_requests`** — older "sent → accepted" booking flow with its own `agreed_total`. `financials.ts` keeps it only for back-compat ("legacy").

Neither table has `paid_at`, `paid_amount_cents`, or a payment-record event. There is no contractor-payouts table, no Stripe Connect, nothing that fires "X was paid $Y today". `wedding_team` rows are written when crew are assigned in the Roster UI (`studio.roster.tsx`) / `ServicesAndTeamCard`.

**Implication:** YTD "pay" must be defined as a proxy. The two reasonable options:
- **(A)** `SUM(wedding_team.agreed_total)` joined to `clients.wedding_date` whose year = target year (counts a contractor as "paid" once their wedding date has passed, or counts on booking).
- **(B)** Add a real `contractor_payments` table that the owner records into manually when she actually cuts checks; YTD = sum of those.

This is the #1 decision Victoria has to make (see Open Questions).

### 3. Tokenized public page pattern (model to reuse)
- Token column: `invoice_recipients.view_token text UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex')` (migration `20260511185218`).
- Public route: `src/routes/api/public/couple-invoices.$token.ts` — uses `supabaseAdmin` (service role) inside the handler, validates token shape (`/^[a-zA-Z0-9_-]+$/`, length 16–256), `.eq("view_token", token).maybeSingle()`, returns only scoped data.
- Public page: `src/routes/pay.$token.tsx` — no auth, calls `/api/public/...` endpoints.
- This is the exact template for the W-9 upload page.

### 4. Storage
Only one bucket exists: **`message-attachments`** (private). Pattern: `supabase.storage.from("message-attachments")` with `.createSignedUrl(path, ttl)` for owner reads, RLS on `storage.objects` scoped by `bucket_id`. No public buckets. New buckets must be created via the `supabase--storage_create_bucket` tool, not raw SQL.

### 5. Email
- `sendEmail()` in `src/integrations/postmark/client.server.ts` (server-only) — all sends go through it.
- Logged to `email_sends` (`to_address, from_address, subject, template_key, status, postmark_message_id, client_id, invoice_id, error_message, …`).
- `email_templates` table exists for editable copy keyed by `template_key`.
- No `contractor_id` FK on `email_sends` today (would need to add or stash in `template_key`/metadata).
- Per CLAUDE.md convention: any new automated email behind a feature flag default **OFF**; never block the triggering DB write on email-send failure; failures logged + owner notified.

### 6. Admin UI surfaces
- `src/components/studio/ContractorEditorModal.tsx` — per-contractor editor (natural home for W-9 status + manual "Request W-9 now" + owner-only "Download W-9").
- `src/routes/studio.settings.contractors.tsx` — directory; add a "W-9" column/badge + filter "Missing W-9 (≥$600)".
- `src/routes/studio.roster.tsx` — could surface a small W-9 warning chip next to contractors that owe one.
- **New** route for the year-end 1099 report (proposal: `src/routes/studio.settings.contractors.tax-year.$year.tsx` or a tab inside the existing settings page).

Owner-only gating: `has_role(_user_id, 'owner')` / `is_owner(_user_id)` already exist in DB.

---

## STEP 2 — Proposed plan (no code)

### Schema additions

**`contractors`** — add:
- `w9_collected boolean NOT NULL DEFAULT false`
- `w9_collected_at timestamptz`
- `w9_file_path text` (path inside the private `contractor-tax-docs` bucket)
- `w9_requested_at timestamptz` (last time we emailed a request — for the "this year" idempotency window)
- `legal_name text` (W-9 line 1 — often differs from `full_name`)
- `business_type text` (enum-ish: individual / sole-prop / LLC / S-corp / C-corp / partnership / other — free text initially)
- `mailing_address text` (1099s must be mailed; homebase coords aren't an address)
- *Deliberately NOT stored in `contractors`:* SSN/EIN. We do not store the tax ID number itself in a DB column — the W-9 PDF in private storage is the source of truth. (Open Q if Victoria wants a separate encrypted field.)

**New `contractor_w9_requests` table** (tokenized upload sessions; mirrors `invoice_recipients`):
- `id uuid pk`
- `contractor_id uuid not null references contractors`
- `view_token text not null unique default encode(gen_random_bytes(24),'hex')`
- `reason text` (e.g. `'auto_threshold_2026'`, `'manual'`)
- `created_at timestamptz`
- `expires_at timestamptz` (e.g. +90 days)
- `uploaded_at timestamptz`
- `email_send_id uuid` (link to `email_sends` row)
- Unique partial index `(contractor_id) WHERE uploaded_at IS NULL` so only one active open request per contractor.
- RLS: owner-only via `is_owner(auth.uid())`. Public token lookup happens through `supabaseAdmin` in the public API route, so no anon RLS policy needed.

**Storage bucket** `contractor-tax-docs` — **private**, created via `storage_create_bucket` tool. RLS on `storage.objects`:
- INSERT: allowed via service role only (upload happens through a public API endpoint that uses `supabaseAdmin`, gated by a valid unconsumed token).
- SELECT: owner only (`is_owner(auth.uid())`) — never `authenticated` broadly. Owner reads via `createSignedUrl(path, 60)`.
- No public bucket, no listing, no `anon` policy.

**YTD pay computation** — start as a **SQL view** `contractor_ytd_pay(contractor_id, tax_year, total_cents)` summing `wedding_team.agreed_total` joined to `clients.wedding_date` (year-based). Easy to swap the view definition if Victoria later wants the manual-payments-table model.

### $600 trigger mechanism

- **Hook point:** `AFTER INSERT OR UPDATE OF agreed_total ON wedding_team` trigger.
- **Action:** for the affected `(contractor_id, year=EXTRACT(YEAR FROM wedding_date))`, recompute YTD sum. If `>= 60000` cents AND `contractors.w9_collected = false` AND no `contractor_w9_requests` row for this contractor in the current tax year, **enqueue** a row in `scheduled_communications` (existing infra) or call a small `request_contractor_w9(contractor_id, reason)` SQL function that:
  1. Inserts a `contractor_w9_requests` row (the partial unique index gives idempotency).
  2. Sets `contractors.w9_requested_at = now()`.
  3. Enqueues the email send (does NOT call Postmark from inside the trigger — that's done by the existing send-processor / a tiny server function the trigger inserts a job for).
- **Feature flag** in `studio_settings` (new bool `w9_auto_request_enabled`, default **false**). Trigger is a no-op when off.
- **Idempotency** is enforced by the partial unique index on `contractor_w9_requests(contractor_id) WHERE uploaded_at IS NULL` plus a per-(contractor, tax_year) check.
- **Failure handling:** email send happens out-of-band — if it fails, the row in `contractor_w9_requests` stays valid (owner can resend manually). `email_sends.status='failed'` triggers existing owner notification. The `wedding_team` insert is never blocked.

### Secure tokenized upload page (contractor-facing, no login)

- **Public API routes** (under `src/routes/api/public/`, using `supabaseAdmin`):
  - `GET /api/public/w9-request/$token` — validate token shape, look up request, return `{ contractor_name, expires_at, already_uploaded }`. Never return the contractor's email or other PII beyond first name.
  - `POST /api/public/w9-request/$token/upload` — accept a single PDF (server-side enforce: `application/pdf`, max ~10MB), upload to `contractor-tax-docs/{contractor_id}/{request_id}.pdf` using `supabaseAdmin`, update `contractors.w9_collected=true, w9_collected_at=now(), w9_file_path=...`, set `contractor_w9_requests.uploaded_at=now()`. Returns success.
- **Public page** `src/routes/w9.$token.tsx` — simple branded page: "Hi {first_name}, please upload your completed W-9 (PDF)". States: form / success / expired / already-uploaded / invalid. `meta: noindex,nofollow`.
- The contractor's SSN/EIN never touches our DB columns — it lives only inside the PDF in the private bucket.

### Admin surface (owner-only)

- **`ContractorEditorModal`**: add a "Tax / W-9" section showing:
  - Status badge: "On file" (with collected date) / "Requested {date}" / "Not requested".
  - Owner-only "Download W-9" button → server function returns a 60-second signed URL.
  - Buttons: "Request W-9 now" (creates a new `contractor_w9_requests` row + sends email; manual override of the idempotency check). "Mark as collected manually" (for paper W-9s — uploads file from owner's machine into the same bucket).
  - Fields: `legal_name`, `business_type`, `mailing_address`.
- **`/studio/settings/contractors`** directory: add column "W-9", and a filter chip "Owes W-9 (≥$600 YTD)".
- **`/studio/roster`**: small "⚠ W-9" pill next to contractor name when `agreed_total YTD ≥ $600` and not collected. Visible to owner only.
- **New 1099 report page** `src/routes/studio.settings.contractors.tax.$year.tsx` (owner-only, gated server-side via `is_owner`): table of every contractor with YTD total ≥ $600 for that year, columns: legal name, mailing address, business type, total paid (cents), W-9 status, link to download W-9. Buttons: "Send reminder to all without W-9", CSV export (feeds whatever 1099 e-file tool Victoria uses).

### Email

- New `email_templates` row `template_key='contractor_w9_request'` (subject + body editable in Settings → Email templates, following the existing pattern).
- Logged to `email_sends` with `template_key='contractor_w9_request'`. Add nullable `contractor_id uuid` column to `email_sends` so failures are owner-pingable per contractor.
- Reminder email `contractor_w9_reminder` for the 1099-report "Send reminders" action.
- Footer makes clear it's tax-form collection, links to the tokenized upload URL only (no SSN/EIN in the email body, ever).

### Build order (smallest-first, each independently shippable)

1. **Schema slice** — `contractors` columns + `contractor_w9_requests` table + bucket + RLS + `contractor_ytd_pay` view. No UI, no triggers, no emails. Verifiable with SQL.
2. **Owner manual flow** — `ContractorEditorModal` shows W-9 status; "Mark as collected manually" upload (owner→private bucket); "Download W-9" signed URL. No tokenized page, no auto-trigger yet. Lets Victoria backfill what she already has.
3. **Tokenized upload page** — public API + `/w9/$token` page + "Request W-9 now" button in modal that creates a request row and emails the link. Still manual, no $600 trigger.
4. **1099 year-end report** — new page, CSV export, "Send reminder" bulk action. Useful immediately at year-end even without auto-trigger.
5. **Auto $600 trigger** — DB trigger on `wedding_team` + `studio_settings.w9_auto_request_enabled` flag (default OFF). Victoria enables it when she's confident.
6. **Polish** — roster warning pills, contractors-directory filter chip, audit log entries.

### Security checklist (owner-only walls)

- RLS on `contractor_w9_requests` and `contractors.w9_*` reads gated to `is_owner(auth.uid())` — managers/associates must not read W-9 file paths.
- RLS on `storage.objects` for `contractor-tax-docs` — owner SELECT only; INSERT only via service role.
- W-9 download = always a fresh 60-second signed URL minted by an owner-only server function; never a public URL, never stored.
- Public upload API: strict PDF mime check, size cap, token shape regex, single-use semantics (`uploaded_at` flips), token expiry honored.
- No SSN/EIN ever written to a column, ever logged, ever in an email body.

---

## Open questions / decisions for Victoria

1. **What counts as "paid"?** No `paid_at` exists today. Options:
   (a) Sum `wedding_team.agreed_total` where `clients.wedding_date` is in the tax year (booking = pay).
   (b) Sum where wedding date has already passed (post-wedding = pay).
   (c) Add a real `contractor_payments` table she records into when she actually cuts checks.
   This drives the whole YTD definition.
2. **Calendar year vs rolling 12 months** for the $600 threshold? IRS rule is calendar year — assume that unless she says otherwise.
3. **$600 boundary semantics** — trigger at `>= $600` or `> $600`? (IRS: $600+, so `>=`.)
4. **Upfront collection** — does she want to optionally request a W-9 on the *first* booking of a contractor, regardless of $600 (best practice)? If yes, the manual "Request W-9 now" button covers it; we'd just suggest it in onboarding.
5. **Backfill** — for contractors who already crossed $600 in 2026 before the feature ships, do we auto-email them on first deploy, or only show them in the 1099 report and let her hit "Send reminders"? (Recommend the latter — safer.)
6. **Tax ID storage** — store the SSN/EIN as a separate (encrypted) field, or leave it locked inside the W-9 PDF only? (Recommend PDF-only — smaller blast radius.)
7. **Token expiry** — default 90 days OK?
8. **Email-sends FK** — OK to add `contractor_id` to `email_sends`?
