# T-110 handoff (backend)

Scope: `.github/workflows/ci.yml` only. PR #215, head a35615f (plus this handoff commit).

- `e2e-mock`: `container: mcr.microsoft.com/playwright:v1.63.0-noble`, options `--user 1001 --ipc=host --init`. Worked first try.
- `supabase`: host runner; only the Playwright step runs via `docker run --network host --ipc=host --init --user $(id -u):$(id -g) -e HOME=/tmp -e CI=true` with the Supabase env vars passed by name.
- Both jobs have a step that fails if the image tag does not match the locked `@playwright/test` version (1.63.0). Tag is written twice (workflow `env.PLAYWRIGHT_IMAGE` and `container.image`; the `env` context is not allowed in `container`). Upgrade Playwright = change both plus the lockfile.
- Removed the T-108 cache and install-deps steps. Timeouts stay 35. `checks` and `ci` unchanged.
- CI run 39882767635 green. Times: checks 2m40s, e2e-mock 10m33s, supabase 17m45s (T-108 run: supabase 28m34s).
- Note: GitHub says ubuntu-latest moves to Ubuntu 26; the image is independent of the host OS (noble).
- Builder choices not confirmed by Jimmy: pinned `noble`; kept setup-node (Node 24) inside the container instead of the image's Node; `--user` runner uid rather than root.
