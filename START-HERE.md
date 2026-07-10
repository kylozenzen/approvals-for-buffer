# Start here

This repository is the **Buffer-only Receipts MVP**.

## What “Buffer-only” means

- Posts are created, edited, hosted, scheduled, and published in Buffer.
- Receipts has **no composer, no native upload flow, and no media library**.
- Receipts stores only the approval layer: clients, review-room links, comments, immutable Buffer snapshots, owner-code decisions, and receipts.
- Supabase is therefore approval storage, not a replacement content platform.

## Fastest path

1. Create a new empty GitHub repository.
2. Unzip this package and upload the contents of this folder to the repository root.
3. Import the repository into Netlify.
4. Create a free Supabase project and run `supabase/migrations/001_receipts_beta.sql`.
5. Copy `.env.example` values into Netlify environment variables.
6. Add your Buffer API key as `BUFFER_API_KEY` for the first owner-only test.
7. Deploy, open `/app`, and sign in by magic link.

The app runs as an interactive demo when Supabase is not configured, so you can inspect the interface before connecting anything.
