# PassCode

Automated network password rotation with individually authenticated, logged access to the current password.

PassCode rotates the password of a built-in **virtual router**; it does not connect to physical network hardware. It is a **demo**: it runs locally and is not deployed publicly.

Guides: [for administrators](docs/ADMIN.md) · [for people who need the Wi-Fi password](docs/USER.md).

Project planning lives in [PRD.md](PRD.md), [STYLES.md](STYLES.md) and [TASKLIST.md](TASKLIST.md). Session prompt: [PROMPT.md](PROMPT.md).

## Stack

Next.js 16 (TypeScript, App Router) · Tailwind CSS 4 + shadcn/ui · MongoDB (Atlas) + Mongoose · Zod · Auth.js · Claude (Anthropic API) · Vitest + Playwright

## Run the demo

With `.env` filled in as described below (`DATABASE_URL`, `PASSCODE_ENCRYPTION_KEY`, `AUTH_SECRET`, `AUTH_URL`, and `ANTHROPIC_API_KEY` for the assistant):

```bash
npm install
DATABASE_NAME=passcode_demo npm run demo:seed   # demo accounts, rotations and requests
npm run build
DATABASE_NAME=passcode_demo ROTATION_SCHEDULER_ENABLED=true npm start
```

Open http://localhost:3000 and sign in as `admin@passcode.demo` (the seeding command prints every account and the shared password). `npm run demo:seed` deletes everything in the database it points at, so it refuses any database whose name doesn't end in `_demo` or `_test` unless you pass `--force`.

## Local setup

Requires Node.js 24+.

1. `npm install`
2. `cp .env.example .env` and set `DATABASE_URL`:
   - **MongoDB Atlas** (default): the `mongodb+srv://…` string from Atlas → Connect → Drivers. Make sure your IP is on the Atlas network access list.
   - **Local**: set `MONGO_ROOT_PASSWORD`, run `docker compose up -d --wait`, and use the local URI shown in `.env.example`.
   - If `db:sync` fails with `querySrv ECONNREFUSED` (Node can't resolve SRV records on some Windows setups), use Atlas's standard connection string instead: `mongodb://<user>:<password>@<host1>,<host2>,<host3>/?tls=true&authSource=admin&replicaSet=<replica-set>`. The hosts and replica set name are listed in Atlas under the cluster's connection options.
3. Set `PASSCODE_ENCRYPTION_KEY` (the command to generate one is in `.env.example`). Back it up: without it, stored passwords can't be decrypted.
4. `npm run db:sync` — creates collections and indexes.
5. Set `AUTH_SECRET` (`npx auth secret`, or `openssl rand -base64 33`) and `AUTH_URL`.
6. `npm run user:create-admin -- --email you@example.com` creates the first admin (you'll be asked for a password).
   For the assistant at `/chat`, also set `ANTHROPIC_API_KEY` (and optionally `PASSCODE_NETWORK_NAME` and `PASSCODE_SUPPORT_CONTACT`).
7. `npm run dev` — http://localhost:3000

## Scripts

| Script                      | What it does                                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`               | Dev server                                                                                                                                                                              |
| `npm run build`             | Production build                                                                                                                                                                        |
| `npm run lint`              | ESLint                                                                                                                                                                                  |
| `npm run format` / `:check` | Prettier write / check                                                                                                                                                                  |
| `npm run typecheck`         | Next route typegen + `tsc`                                                                                                                                                              |
| `npm test`                  | Unit tests (no database needed)                                                                                                                                                         |
| `npm run test:integration`  | Integration tests against `DATABASE_URL`, using a separate `passcode_test` database (override with `TEST_DATABASE_NAME`; it must end in `_test`, because the tests delete its contents) |
| `npm run db:sync`           | Create collections and sync indexes with the Mongoose schemas                                                                                                                           |
| `npm run rotate`            | Rotate the network password now (prints the outcome, never the password)                                                                                                                |
| `npm run rotation:worker`   | Run the rotation scheduler as its own process                                                                                                                                           |
| `npm run demo:seed`         | Load demo accounts and activity (needs a `_demo`/`_test` database)                                                                                                                      |
| `npm run test:e2e`          | Playwright end-to-end tests (`npx playwright install chromium` once; uses `passcode_e2e_test`)                                                                                          |
| `npm run user:create-admin` | Create an active admin account (`-- --email <email> [--name <name>]`)                                                                                                                   |

Set `VIRTUAL_ROUTER_FAILURE=always` (or `first-attempt`) to make the virtual router fail on purpose and see the failure path in the admin UI.

## Layout

- `src/app` — routes (UI + route handlers)
- `src/features/<feature>` — feature code per PRD phase (`rotation`, `auth`, `admin`, `chat`)
- `src/lib/db` — MongoDB connection and data models (import from `@/lib/db` in app code)
- `scripts/` — CLI scripts run with `tsx`
