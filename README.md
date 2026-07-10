# Receipts for Buffer — Buffer-only approvals MVP

Receipts is a narrow companion app for Buffer:

> Pull it from Buffer. Send the approval room. Stamp the decision. Keep the receipt.

## The boundary

This is deliberately **Buffer-only**. Buffer remains the system for creating, hosting, editing, scheduling, and publishing posts. Receipts does not include a composer, native uploads, a media library, deals, invoicing, CRM, or another scheduling calendar.

Supabase is used only for the workflow Buffer does not own: client records, public review rooms, comments, requested changes, immutable approval snapshots, owner-code decisions, and saved receipts.

## Included

- Read-only Buffer sync for `draft`, `needs_approval`, and `scheduled` posts
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

Create a Supabase project and run:

```text
supabase/migrations/001_receipts_beta.sql
```

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

For the easiest owner-only Buffer test, also add:

- `BUFFER_API_KEY`

Generate a strong encryption secret with:

```bash
openssl rand -base64 48
```

Optional:

- `BUFFER_ORGANIZATION_ID` when the account belongs to multiple Buffer organizations
- `RESEND_API_KEY`
- `RESEND_FROM`

### 4. Buffer connection modes

**Simplest first test:** put your Buffer API key in Netlify as `BUFFER_API_KEY`. It remains server-side.

**Small invite beta:** a tester may paste their own key in Settings. It is stored in that browser and transmitted only to the authenticated Netlify sync function. This is a temporary beta bridge; Buffer OAuth should replace BYO keys before a broad public launch.

Never commit a real Buffer key.

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
- `netlify/functions/_lib/buffer.js` — read-only Buffer GraphQL client
- `supabase/migrations/001_receipts_beta.sql` — approval database schema
- `START-HERE.md` — shortest deployment path

## V1 exclusions

- No post creation or editing in Receipts
- No file uploads or video hosting
- No Buffer write/schedule mutation
- No other social scheduler
- No deals, invoices, CRM, or analytics suite

Those are future decisions only after the approval loop proves useful.
