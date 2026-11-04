# Receipts for Buffer — Buffer-only approvals MVP

Receipts is a narrow companion app for Buffer:

> Pull it from Buffer. Send the approval room. Stamp the decision. Keep the receipt.

## The boundary

This is deliberately **Buffer-only**. Buffer remains the system for creating, hosting, editing, scheduling, and publishing posts. Receipts does not include a composer, native uploads, a media library, deals, invoicing, CRM, or another scheduling calendar.

Supabase is used only for the workflow Buffer does not own: client records, public review rooms, comments, requested changes, immutable approval snapshots, owner-code decisions, and saved receipts.

## Included

- Transient paginated Buffer draft picker that saves only a selected unscheduled draft
- Background refresh of tracked posts without bulk persistence
- Buffer media thumbnails/source references when the API returns assets
- Client assignment
- One stable no-login approval room per client
- Comments and change requests
- Six-digit owner-code final approval
- Immutable snapshots and SHA-256 fingerprints
- Detection when a Buffer post changed after review began
- Stable receipt IDs and searchable approval history
- Link and owner-code rotation
- Supabase magic-link creator login
- Optional Resend invitations and confirmation email
- Interactive local/demo mode with no credentials

## Stack

- Static HTML, CSS, and vanilla JavaScript
- Netlify hosting and serverless functions
- Buffer GraphQL API as the only content source
- Supabase Postgres/Auth for approval records and creator sessions
- Resend optionally for email

## Local visual demo

```bash
npm run check
npm run serve
```

Open `http://localhost:8888/app.html`. Without Supabase environment variables, the app automatically uses local sample data.

## Deploy the real shared beta

### 1. Supabase

Create a Supabase project and run the migrations in order:

```text
supabase/migrations/001_receipts_beta.sql
supabase/migrations/002_beta_hardening.sql
supabase/migrations/003_buffer_oauth_and_notes.sql
supabase/migrations/004_beta_capacity_selective_import.sql
```

Run migration 004 after 001–003 and BEFORE running this application branch. Existing over-limit content remains untouched until explicitly archived.

Enable Email/Magic Link authentication. Add your production Netlify URL and `https://YOUR-SITE.netlify.app/app` to Supabase Auth redirect URLs.

### 2. GitHub and Netlify

Push this folder to a fresh GitHub repository, then import that repository into Netlify. The included `netlify.toml` already defines the publish folder, functions folder, app routes, review-room routes, and basic security headers.

### 3. Environment variables

Copy `.env.example` into Netlify’s environment-variable panel. Required:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RECEIPTS_ENCRYPTION_SECRET`
- `APP_BASE_URL`

Optional for an owner-managed test environment:

- `BUFFER_API_KEY`

Generate a strong encryption secret with:

```bash
openssl rand -base64 48
```

Optional:

- `BUFFER_OAUTH_CLIENT_ID` to turn on **Connect with Buffer** (see below)
- `BUFFER_OAUTH_SCOPE` to override the requested scopes (default `posts:read posts:write account:read notes:read notes:write offline_access`)
- `BUFFER_ORGANIZATION_ID` when the account belongs to multiple Buffer organizations
- `RESEND_API_KEY`
- `RESEND_FROM`

### 4. Buffer connection modes

Receipts picks a Buffer token in this order: a key pasted in the current tab → the creator's Buffer connection → `BUFFER_API_KEY`.

**Connect with Buffer (OAuth):** creators sign in with Buffer once and stay connected.

1. Create an OAuth app in Buffer's developer settings and register the redirect URI `https://YOUR-SITE.netlify.app/auth/buffer/callback` (add `http://localhost:8888/auth/buffer/callback` if you test locally with `netlify dev`).
2. Put its client ID in `BUFFER_OAUTH_CLIENT_ID` and redeploy. If Buffer issued your app a client secret, add it as `BUFFER_OAUTH_CLIENT_SECRET`; PKCE apps don't need one.
3. Run migration 003.

The browser starts the PKCE flow; the Netlify function exchanges the code, encrypts the access and refresh tokens with `RECEIPTS_ENCRYPTION_SECRET`, and stores them in `buffer_connections` (no browser or anon access). Expiring tokens refresh server-side. If a refresh fails, Settings shows **Reconnect Buffer**. The `notes:read` and `notes:write` scopes power the Buffer Notes sync below.

**Pasted API key:** each tester signs in, pastes their own Buffer API key in Settings, and syncs only their own Buffer content into approval rooms. The key is held only in page memory for the current tab/session; it is not written to `localStorage`, Supabase, or Receipts records. It is sent in the request header solely to perform the read-only Buffer sync, then must be pasted again after a refresh.

**Optional owner-managed mode:** configure `BUFFER_API_KEY` server-side when you want the deployed environment to supply a fallback key.

Never commit a real Buffer key.

### 5. Buffer Notes (both directions)

Receipts uses Buffer's Notes API (`collaborationNotes`, `createCollaborationNote`). It is experimental on Buffer's side and needs the `notes:read` and `notes:write` scopes. **Existing keys and tokens do not get Notes access automatically:** make a new Buffer API key with Notes enabled, or reconnect Buffer in Settings.

- **Buffer → Receipts:** each sync reads the Notes thread on every post that is already in a client room and mirrors it into that post's thread, tagged **Buffer note**. Edits and deletions in Buffer carry over. Buffer notes are internal by default; **Share with client** shows one in the room as *From the team*.
- **Receipts → Buffer:** Buffer Notes stay a to-do list for whoever edits the post. A **change request** becomes one Note (*"Changes requested by James (Coffee Chaz): …"*) with a link to the full thread in Receipts (`/app?post=…`, sign-in required — never the client room link). When the client **approves**, that post's change-request Notes are deleted from Buffer and one approval Note is added. **Plain comments stay in Receipts.** This uses the creator's Buffer connection or `BUFFER_API_KEY`; anything the client room couldn't send is sent from the creator's side on the next sync or when the post is opened.
- Notes never change the approval fingerprint. If the token lacks Notes scopes, posts still sync and the app says what to fix. Buffer failing never blocks a client's comment.

## Approval integrity

When a post is sent for review, Receipts stores an immutable snapshot containing the Buffer post ID, caption, channel, schedule, Buffer status, asset references, and fingerprint. The client approves that snapshot, not an endlessly changing live record.

If Buffer returns different content during a later sync, Receipts creates a new version and marks the old review as changed. The revised snapshot must be sent again before approval.

## Repository map

- `index.html` — product landing page
- `app.html` — creator dashboard and public approval room shell
- `js/` — browser state, API adapter, auth, actions, and UI
- `styles/` — landing and app styling
- `netlify/functions/creator-api.js` — authenticated creator actions and Buffer sync
- `netlify/functions/review-api.js` — public comments, changes, and approval
- `netlify/functions/_lib/buffer.js` — read-only Buffer GraphQL client (posts + notes)
- `netlify/functions/_lib/buffer-oauth.js` — Buffer OAuth code exchange, encrypted token storage, refresh
- `js/shared/oauth.js` — PKCE client shared with PostIQ
- `supabase/migrations/001_receipts_beta.sql` — approval database schema
- `START-HERE.md` — shortest deployment path

## V1 exclusions

- No post creation or editing in Receipts
- No file uploads or video hosting
- No Buffer write/schedule mutation
- No other social scheduler
- No deals, invoices, CRM, or analytics suite

Those are future decisions only after the approval loop proves useful.

## Beta capacity, archiving, and verification (migration 004)

Each creator has at most three active client rooms, and each room has one active imported Buffer post. Every active status including approved consumes the slot. Archive a post to free its slot; snapshots, comments and receipts remain. Archiving a room revokes public access and archives its active posts. Neither action changes or deletes Buffer content.

Browse and pagination are transient; import writes exactly one selected unscheduled draft and its snapshot in a transaction. Background refresh updates tracked posts only. Database triggers use transaction-scoped advisory locks, and the import is an atomic Postgres RPC. Legacy over-limit content is NOT deleted or silently archived. Review the room labels, archive excess posts, then archive surplus rooms before making new ones.

**Mocked checks:** Run npm test (including scripts/test-beta-capacity.js). These cover demo limits, browse without persistence, imports, archives, historical receipts, and the existing approval integrity suite.

**Database-backed verification still required in isolated Supabase (migration 004 applied):**

1. Starting from two rooms, race two inserts for a third active room. Exactly one must succeed; the other must receive a quota error.
2. Race two imports of distinct drafts into one empty room. Exactly one must commit, with one initial snapshot; verify unauthorized client IDs fail.
3. Seed an existing workspace with four rooms and another with two active posts in a room before migration. Applying 004 must preserve all rows; capacity-increasing writes must fail while archive/review works.
4. Archive an approved post and its room. Verify comments, all snapshot versions and receipts persist, public room calls reject the old token, and the Buffer source remains unchanged.
5. Browse multiple pages and run background sync. Confirm never-selected posts and their snapshots are absent; changes to already tracked posts still create snapshots and invalidate in-flight approvals.
6. Verify real Buffer connection, pagination beyond fifty results, note scopes, owner-code approval and cross-creator isolation.

These steps are pending live verification, not completed database-backed test results.
