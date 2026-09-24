# PassCode

Automated network password rotation with individually authenticated, logged access to the current password.

PassCode rotates the password of a built-in **virtual router** on a schedule, and hands the current password only to people who sign in with their own approved account, through a chat assistant. Every request is logged. An admin app manages accounts, the rotation schedule and the activity log.

It is a **demo**: it runs locally, does not connect to physical network hardware, and is not deployed publicly.

## Contents

- [What you need](#what-you-need)
- [Quick start (demo data)](#quick-start-demo-data)
- [Environment variables](#environment-variables)
- [Setting up without demo data](#setting-up-without-demo-data)
- [Scripts](#scripts)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)
- [Project layout and docs](#project-layout-and-docs)

## What you need

| Requirement                   | Version / notes                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node.js**                   | **24 or newer** (`node -v`). Comes with npm.                                                                                                                       |
| **Git**                       | Any recent version.                                                                                                                                                |
| **MongoDB**                   | A **replica set**, because PassCode uses multi-document transactions. Either a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster, or Docker (see below). |
| **Docker Desktop** (optional) | Only if you run MongoDB locally with the included `docker-compose.yml` instead of Atlas.                                                                           |
| **Gemini API key** (optional) | Free from [Google AI Studio](https://aistudio.google.com/apikey). Needed only for the chat assistant at `/chat`. Everything else works without it.                 |

Everything else is an npm package that `npm install` installs from `package-lock.json`. The main ones are:

- **App:** Next.js 16 (App Router, TypeScript), React 19, Tailwind CSS 4 + shadcn/ui, TanStack Query
- **Data and auth:** MongoDB + Mongoose, Auth.js (next-auth v5), bcrypt, Zod
- **Assistant:** `@google/genai` (Gemini, the default) or `@anthropic-ai/sdk` (Claude)
- **Scheduling:** node-cron
- **Tooling:** Vitest, Playwright, ESLint, Prettier, tsx (runs the `scripts/`)

## Quick start (demo data)

This gets you a running app, filled with demo accounts and activity, in about five minutes. The commands work in PowerShell, bash and zsh.

**1. Clone and install**

```bash
git clone https://github.com/Hax905/Pass-code.git
cd Pass-code
npm install
```

**2. Create your `.env`**

```bash
cp .env.example .env
```

(On Windows `cmd`, use `copy .env.example .env`.) `.env` is gitignored, so never commit it.

**3. Get a database.** Pick one:

- **Docker (easiest):** in `.env`, set `MONGO_ROOT_PASSWORD` to any password you make up, then set
  `DATABASE_URL=mongodb://passcode:<that password>@127.0.0.1:27017/?authSource=admin&directConnection=true`
  and start MongoDB with:

  ```bash
  docker compose up -d --wait
  ```

- **MongoDB Atlas:** create a free cluster and a database user, add your IP under **Network Access**, and paste the `mongodb+srv://…` string from **Connect → Drivers** into `DATABASE_URL`.

**4. Fill in the rest of `.env`**

| Variable                     | Set it to                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_NAME`              | `passcode_demo` (the seeding command only runs against names ending in `_demo` or `_test`) |
| `PASSCODE_ENCRYPTION_KEY`    | Output of `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`    |
| `AUTH_SECRET`                | Output of `npx auth secret` (or run the same `node -e …` command above again)              |
| `AUTH_URL`                   | `http://localhost:3000` (already set)                                                      |
| `ROTATION_SCHEDULER_ENABLED` | `true` if you want scheduled rotations to run                                              |
| `GEMINI_API_KEY`             | Your Google AI Studio key, if you want the assistant                                       |

**5. Seed, build and start**

```bash
npm run demo:seed
npm run build
npm start
```

Open **http://localhost:3000**. `demo:seed` prints every account. They all use the password `passcode demo 2026`:

| Account                  | Role                   |
| ------------------------ | ---------------------- |
| `admin@passcode.demo`    | Admin                  |
| `diego@passcode.demo`    | Admin                  |
| `maria@passcode.demo`    | User                   |
| `carlos@passcode.demo`   | User                   |
| `former@passcode.demo`   | Revoked (gets nothing) |
| `newcomer@passcode.demo` | Pending approval       |

> `npm run demo:seed` **deletes everything** in the database it points at. That's why it refuses a database whose name doesn't end in `_demo` or `_test` unless you pass `--force`.

For development with hot reload, run `npm run dev` instead of `build` + `start`.

**Showing a rotation:** the seeded demo starts with four devices on the virtual Wi-Fi, one of them with no account. Put the admin dashboard's **On the network** panel next to a user's **Network** tab (for example, in a second browser profile signed in as `maria@passcode.demo`) and press **Rotate now**. Within a few seconds the admin list empties and the user's device reports it was dropped. The user then asks the assistant for the new password and reconnects.

The guides [for administrators](docs/ADMIN.md) and [for people who need the Wi-Fi password](docs/USER.md) walk through the app itself.

## Environment variables

`.env.example` documents every variable. In summary:

| Variable                                                   | Required    | Purpose                                                                                                |
| ---------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                             | Yes         | MongoDB connection string (`mongodb://` or `mongodb+srv://`), pointing at a replica set                |
| `DATABASE_NAME`                                            | No          | Database name. Defaults to `passcode`                                                                  |
| `PASSCODE_ENCRYPTION_KEY`                                  | Yes         | 32-byte base64 key that encrypts the network password at rest. If you lose it, run a fresh rotation.   |
| `AUTH_SECRET`                                              | Yes         | Signs and encrypts login sessions                                                                      |
| `AUTH_URL`                                                 | Yes         | Public base URL, `http://localhost:3000` locally                                                       |
| `ROUTER_ADAPTER`                                           | No          | Only `mock` (the virtual router) exists                                                                |
| `ROTATION_SCHEDULER_ENABLED`                               | No          | `true` runs the rotation scheduler inside the web server. Or run `npm run rotation:worker` separately. |
| `VIRTUAL_ROUTER_FAILURE`                                   | No          | `always` or `first-attempt` makes the virtual router fail on purpose, to show the failure path         |
| `CHAT_PROVIDER`                                            | No          | `gemini` (default) or `anthropic`                                                                      |
| `GEMINI_API_KEY`                                           | For `/chat` | Needed when `CHAT_PROVIDER=gemini`                                                                     |
| `GEMINI_MODELS`                                            | No          | Comma-separated models to try in order when the free tier is busy                                      |
| `ANTHROPIC_API_KEY`                                        | For `/chat` | Needed when `CHAT_PROVIDER=anthropic` (needs paid API credits)                                         |
| `PASSCODE_NETWORK_NAME`, `PASSCODE_SUPPORT_CONTACT`        | No          | Shown by the assistant when people ask how to connect or whom to contact                               |
| `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD`, `MONGO_PORT` | Docker only | Credentials for the local `docker-compose.yml` MongoDB                                                 |

About the Gemini free tier: it is rate- and capacity-limited, so requests come back 503 under load and 429 once a model's daily quota runs out. The assistant falls through the `GEMINI_MODELS` list when that happens. Google's free tier may also use submitted chat text for product improvement. The network password itself never reaches the model.

## Setting up without demo data

To start from an empty database with your own admin account:

1. Follow steps 1–4 of the quick start, but set `DATABASE_NAME` to something like `passcode`.
2. `npm run db:sync` creates the collections and indexes.
3. `npm run user:create-admin -- --email you@example.com` creates the first admin (it asks for a password).
4. `npm run dev`, sign in, and save the rotation settings under **Admin → Rotation**. Nothing rotates until you do.

## Scripts

| Script                      | What it does                                                                     |
| --------------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`               | Dev server with hot reload                                                       |
| `npm run build`             | Production build                                                                 |
| `npm start`                 | Serve the production build                                                       |
| `npm run lint`              | ESLint                                                                           |
| `npm run format` / `:check` | Prettier write / check                                                           |
| `npm run typecheck`         | Next route typegen + `tsc`                                                       |
| `npm test`                  | Unit tests (no database needed)                                                  |
| `npm run test:integration`  | Integration tests against a real database (see [Tests](#tests))                  |
| `npm run test:e2e`          | Playwright end-to-end tests                                                      |
| `npm run db:sync`           | Create collections and sync indexes with the Mongoose schemas                    |
| `npm run rotate`            | Rotate the network password now (prints the outcome, never the password)         |
| `npm run rotation:worker`   | Run the rotation scheduler as its own process                                    |
| `npm run demo:seed`         | Reset a `_demo`/`_test` database and load demo accounts and activity             |
| `npm run user:create-admin` | Create an active admin account (`-- --email <email> [--name <name>]`)            |
| `npm run chat:live-check`   | Check the configured chat provider end to end against a `_demo`/`_test` database |

## Tests

- **Unit:** `npm test`. Needs no database or `.env`.
- **Integration:** `npm run test:integration`. Uses `DATABASE_URL` but always runs against a separate `passcode_test` database, which it wipes (override the name with `TEST_DATABASE_NAME`, which must end in `_test`).
- **End-to-end:** run `npx playwright install chromium` once, then `npm run build` and `npm run test:e2e`. Playwright starts the production build itself, seeded into a separate `passcode_e2e_test` database.

CI (`.github/workflows/ci.yml`) runs lint, format check, typecheck, unit tests and build, then the integration and e2e suites against the Docker MongoDB.

## Troubleshooting

- **`querySrv ECONNREFUSED` with an Atlas `mongodb+srv://` URL** (seen on some Windows setups where Node can't resolve SRV records): use Atlas's standard connection string instead,
  `mongodb://<user>:<password>@<host1>,<host2>,<host3>/?tls=true&authSource=admin&replicaSet=<replica-set>`.
  The hosts and replica-set name are listed in Atlas under the cluster's connection options.
- **Every database call times out, or you get `ENOTFOUND` / server selection errors with Atlas:** your public IP has probably changed and is no longer on the Atlas **Network Access** list. Add it again.
- **`Invalid server environment: …`** at startup: the message names the variable that is missing or malformed. Compare `.env` with `.env.example`.
- **`Transaction numbers are only allowed on a replica set member`:** the MongoDB you pointed at is a standalone server. Use Atlas or the included `docker-compose.yml`, which both run a replica set.
- **The assistant says it "couldn't finish that request":** check `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`). `npm run chat:live-check` tests the provider directly. On the Gemini free tier, a 503 or 429 usually just means you should wait and retry.
- **`npm install` fails building `bcrypt`:** bcrypt ships prebuilt binaries for common platforms. If yours isn't covered, install your OS's C++ build tools (on Windows, "Desktop development with C++" from the Visual Studio Build Tools) and run `npm install` again.

## Project layout and docs

```
src/app/                 Routes: pages and API route handlers
src/features/<feature>/  Feature code: rotation, auth, admin, chat, network
src/lib/db/              MongoDB connection and data models (import from "@/lib/db")
src/lib/                 Shared helpers: env validation, encryption at rest, utilities
scripts/                 CLI scripts run with tsx
e2e/                     Playwright tests
docs/                    Guides and project planning documents
```

| Document                                                           | What's in it                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [docs/ADMIN.md](docs/ADMIN.md)                                     | Using the admin app                                                    |
| [docs/USER.md](docs/USER.md)                                       | Getting the Wi-Fi password as a user                                   |
| [docs/HOW-PASSCODE-WORKS.txt](docs/HOW-PASSCODE-WORKS.txt)         | Plain-text overview of how the system works                            |
| [docs/PASSCODE-FUNCTIONALITY.txt](docs/PASSCODE-FUNCTIONALITY.txt) | Plain-text walkthrough of every feature                                |
| [docs/PRD.md](docs/PRD.md)                                         | Product requirements: the problem, goals and scope                     |
| [docs/STYLES.md](docs/STYLES.md)                                   | Technical design: stack, conventions, data model                       |
| [docs/TASKLIST.md](docs/TASKLIST.md)                               | Build plan and session log, including every decision that was reversed |
