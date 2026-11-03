# Changelog

## 1.3.0 — Buffer notes + Connect with Buffer

- Buffer notes on each synced post now appear in its Receipts thread, tagged "Buffer note". Edits and deletions in Buffer carry over on the next sync.
- Buffer notes are hidden from client rooms by default; creators can share or hide each one.
- Notes never change the snapshot fingerprint, so they don't reset approvals.
- Added "Connect with Buffer" (OAuth + PKCE). Tokens are encrypted server-side in Supabase and refreshed automatically; Settings shows connected / reconnect / disconnect states.
- Pasting an API key still works and takes priority for the current tab.
- New migration `003_buffer_oauth_and_notes.sql`; new env vars `BUFFER_OAUTH_CLIENT_ID` (+ optional `BUFFER_OAUTH_CLIENT_SECRET`, `BUFFER_OAUTH_SCOPE`).

## 1.1.0 — Cohort beta loop

- Added a guided Buffer → client → review flow on the board.
- Added a session-only Buffer connection prompt and multi-organization picker.
- Combined client assignment and sending for review into one action.
- Made public rooms render the exact saved review snapshot.
- Restored the receipt-email resend route and hardened client reassignment.
- Added Buffer adapter and demo approval-loop tests.

## 1.0.0 — Buffer-only MVP

- Made Buffer the exclusive content source.
- Added Buffer asset thumbnail/source retrieval.
- Kept Receipts storage limited to approval workflow records and immutable snapshots.
- Added GitHub Actions syntax checks, package metadata, favicon, and start-here deployment guide.
- Kept native uploads, composer, publishing, deals, CRM, and other schedulers out of scope.
