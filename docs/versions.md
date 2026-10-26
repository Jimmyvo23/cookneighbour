# Versions

Each live version of CookNeighbour, so any of them can be restored. Ask Jimmy before creating a tag or rolling back.

| Version | Commit | Live since | Tag | What it is |
|---|---|---|---|---|
| V1 | `eef2eab` | 2026-10-26 | `v1.0.0` + Release "Version 1" | "Grandma's table" design (T-069), full demo flow, everything MOCK |
| V2 | `b09359c` | 2026-10-26 | not tagged yet (ask Jimmy) | Clay-pot colours, happy-pot logo, map + family-table home page, no gingham (T-126, T-127) |

## How to roll back

- **Normal:** open a pull request that restores the tag's files onto `main`: `git checkout -b rollback/vN && git restore --source vN.0.0 -- .`, commit, then CI and the Reviewer as usual, then merge. Vercel deploys `main`.
- **Emergency:** Jimmy uses "Instant Rollback" in the Vercel dashboard to the older deployment.
- Never force-push `main`.
- Hosted database migrations are **not** undone by a code rollback. Compare `supabase/migrations` between the two versions and ask Jimmy before any database change. V1 to V2 added no migration.
