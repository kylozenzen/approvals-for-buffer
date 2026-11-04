# Changelog

## 1.4.0 — Buffer Notes, both directions

- Moved notes sync to Buffer's new Notes API (`collaborationNotes`). The old `Post.notes` field never sees notes from Buffer's Notes panel.
- Change requests become Buffer Notes with a link to the full Receipts thread; on approval the change-request Notes are deleted and one approval Note is added. Plain comments stay in Receipts.
- Notes are read only for posts already in a client room, four at a time, to stay inside Buffer's rate limits.
- Notes Receipts wrote are never pulled back in as duplicates; client comments are never deleted by sync.
- Default OAuth scopes now include `notes:read notes:write`.
- No more pressing Sync: the board syncs quietly on load, every 2 minutes while open, and when you return to the tab. Opening a post pulls its Buffer notes live.
- Notes errors are shown in the app instead of only in server logs. Missing scopes show a clear "reconnect" or "new key" message instead of failing quietly.

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
