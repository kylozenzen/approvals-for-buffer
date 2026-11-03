# Receipts: November 2026 build plan

## Which repository does what

- `kylozenzen/approvals-for-buffer`: the working Buffer-only app, its own landing page, Netlify functions, Supabase migrations and tests. Main baseline reviewed: `fd94086c642fcc60e32c42dca1cb870dd30753d8` (September 9, 2026).
- `kylozenzen/approvals-waitlist`: the newer standalone waitlist page with responsive walkthrough videos and screenshots. Main baseline reviewed: `02b4c7827e77ac468da4e8055e4c3c8965cd8a76` (October 12, 2026, Central time).
- `https://receiptsdemo.netlify.app/` rendered an older product demo during this review: generic magic links, deal tracking and invoicing. Its deployment-to-repository mapping was not verified. Do not treat this URL as proof the current app has been deployed.

## Existing baseline, not new Commit work

The app already includes Buffer read sync, client rooms, no-account reviewer comments, change requests, owner-code final approval, stored review snapshots, change detection on later sync, approval receipts, room/code rotation and expiry, optional email and a local demo.

The beta currently uses Supabase magic-link creator login plus a session-only pasted Buffer key. There is no Buffer OAuth callback or token refresh flow in this source, and no Buffer notes write integration. The Buffer adapter only reads posts. Local tests pass; they do not demonstrate live Buffer authentication or writes.

## First useful new build: close the feedback loop

1. Validate Buffer OAuth and one create/read collaboration-note round trip on an owned draft before expanding scope. Commit requires OAuth and real API calls.
2. Add a creator-triggered action to send a saved reviewer comment/change request to a note on that exact Buffer post. Keep the reviewer name in the note text; the connected Buffer account remains the API author. Never impersonate the reviewer.
3. Include the saved snapshot version in the handoff. Feedback on an old version must remain labeled as old feedback. Never change a post, schedule it, or mark Buffer-native approval implicitly.
4. Show pending/sent/failed state and the returned Buffer note ID. Protect against double-clicks and concurrent retries. On an ambiguous timeout, check for an existing note before retrying; do not blindly create duplicates.
5. Preserve Receipts approval history if the note write fails. Reviewer comments must not depend on Buffer being online.

The API supports note subjects for posts and Content Items. Start with posts already represented by the app's `buffer_post_id`; add channel-less Content Items only after the post flow works.

## Meaningful next slices, in order

| Priority | Update | Smallest useful version |
| --- | --- | --- |
| 1 | OAuth + attributed notes handoff | Connect Buffer; send one saved comment to one post note with visible success/failure. |
| 2 | Second opinion mode | Share a post with an editor or trusted reviewer without creating a company record or requiring an approval code. Preserve formal client approval as a separate mode. |
| 3 | Resolve feedback | Mark individual change requests open/resolved, grouped by snapshot version. Resolution does not grant approval. |
| 4 | Revision clarity | Show exactly what changed between reviewed captions; keep media/schedule changes visible. |
| 5 | Due dates and reminders | A review deadline and creator-triggered reminder before adding automatic email schedules. |

Defer invoicing, deals/CRM, native media uploads, timeline video annotations, another calendar, automatic scheduling and DMs for this build.

## Submission evidence

Clearly separate the existing September app and October waitlist assets from work completed October 28–November 13. Demonstrate a connected creator, a separate reviewer, feedback appearing on the intended Buffer draft, and the existing version/receipt loop. Track which parts ran with real APIs versus sample data. Notes are experimental; do not advertise them as available until a live test succeeds.

## Validation gates

- Existing `npm test` remains green.
- Creator A cannot write a note to Creator B's Buffer post or export another client's feedback.
- Double-click and retry do not create duplicate notes.
- Reviewer identity, snapshot version and note contents survive the handoff.
- A changed or deleted Buffer post produces an actionable state without losing the review.
- Mobile copy/share and a no-login reviewer session work on a separate browser/device.
- OAuth authorization, refresh, disconnect and a real create/read notes round trip pass before submission.
