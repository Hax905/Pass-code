# NetGuard (Pass-code)

Automated network password rotation with individually authenticated, logged access to the current password.

Project planning lives in [PRD.md](PRD.md), [STYLES.md](STYLES.md) and [TASKLIST.md](TASKLIST.md). Session prompt: [PROMPT.md](PROMPT.md).

## Stack

Next.js 16 (TypeScript, App Router) · Tailwind CSS 4 + shadcn/ui · MongoDB (Atlas) + Mongoose · Zod · Vitest

## Local setup

Requires Node.js 24+.

1. `npm install`
2. `cp .env.example .env` and set `DATABASE_URL`:
   - **MongoDB Atlas** (default): the `mongodb+srv://…` string from Atlas → Connect → Drivers. Make sure your IP is on the Atlas network access list.
   - **Local**: set `MONGO_ROOT_PASSWORD`, run `docker compose up -d --wait`, and use the local URI shown in `.env.example`.
   - If `db:sync` fails with `querySrv ECONNREFUSED` (Node can't resolve SRV records on some Windows setups), use Atlas's standard connection string instead: `mongodb://<user>:<password>@<host1>,<host2>,<host3>/?tls=true&authSource=admin&replicaSet=<replica-set>`. The hosts and replica set name are listed in Atlas under the cluster's connection options.
3. Set `NETGUARD_ENCRYPTION_KEY` (the command to generate one is in `.env.example`). Back it up: without it, stored passwords can't be decrypted.
4. `npm run db:sync` — creates collections and indexes.
5. `npm run dev` — http://localhost:3000

## Scripts

| Script                      | What it does                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`               | Dev server                                                                          |
| `npm run build`             | Production build                                                                    |
| `npm run lint`              | ESLint                                                                              |
| `npm run format` / `:check` | Prettier write / check                                                              |
| `npm run typecheck`         | Next route typegen + `tsc`                                                          |
| `npm test`                  | Unit tests (no database needed)                                                     |
| `npm run test:integration`  | Integration tests against `DATABASE_URL`, using a separate `netguard_test` database |
| `npm run db:sync`           | Create collections and sync indexes with the Mongoose schemas                       |
| `npm run rotate`            | Rotate the network password now (prints the outcome, never the password)            |
| `npm run rotation:worker`   | Run the rotation scheduler as its own process                                       |

## Layout

- `src/app` — routes (UI + route handlers)
- `src/features/<feature>` — feature code per PRD phase (`rotation`, `auth`, `admin`, `chatbot`)
- `src/lib/db` — MongoDB connection and data models (import from `@/lib/db` in app code)
- `scripts/` — CLI scripts run with `tsx`
