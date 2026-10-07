# RLS test suite (T-027)

Runs against the local Supabase stack only. The helper refuses any URL that is not `localhost` or `127.0.0.1`.

```
supabase start
set -a; eval "$(supabase status -o env)"; set +a
npm run test:rls
```

Variables read: `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DB_URL` (these are the public local defaults printed by the CLI, not secrets).
Each test pairs a forbidden case with an allowed case so it cannot pass for the wrong reason.
Fixtures are created once in `global-setup.ts` with unique emails and random hashes, so the suite can be re-run on the same database.
