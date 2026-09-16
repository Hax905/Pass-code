# Task List — NetGuard
## Project: Automated Network Password Rotation & Access Assistant

**Version:** 1.0
**Companion to:** PRD.md, STYLES.md
**Last updated:** 2026-09-14

---

## 0. Documentation Protocol (read this before starting any task)

This file is the shared memory between Claude Code sessions. A session may pick up this project with no other context than PRD.md, STYLES.md, and this file — so the log has to actually reflect reality.

**Every session must, before finishing:**

1. **Mark completed tasks** — check the box `[x]` and add a one-line entry to that phase's **Session Log** with the date, what was completed, and where (files/folders touched).
2. **Document pivots** — if the approach for a task changed from what's written here (e.g., a different library, a different data model, a different adapter pattern than STYLES.md specifies), add a **Pivot** entry: what changed, why, and what it affects downstream. Update the task description itself if the pivot is now the plan going forward, so the next session doesn't rediscover it.
3. **Document failures — only if the user has explicitly asked for failure tracking on this project/session.** By default, do not write failure/blocker narratives into this file. If a task can't be completed, leave it unchecked and briefly note it's blocked and why in one line, but do not produce a detailed failure writeup unless the user has told you to track failures. If the user *has* asked for failure documentation, log it with: what was attempted, why it didn't work, and what was tried instead.
4. **Never mark a task complete if it's partially done.** Split it into a completed sub-task and a new task for the remainder instead — this file should always reflect checkpoints, not partial states.
5. **Leave the repo in a working state** — a task is only "complete" if the app still builds/runs and existing tests still pass. If that's not true, the task isn't done yet, regardless of how much progress was made.

**Session Log entry format:**
```
- [YYYY-MM-DD] [Completed/Pivot/Blocked] <one-line summary> — <files/folders touched>
```

---

## Phase 0 — Foundations
*Goal: a running, empty skeleton. No password logic yet, no UI beyond a placeholder page.*

- [x] Initialize Next.js + TypeScript project per STYLES.md §2.1–2.2
- [x] Set up Tailwind CSS + shadcn/ui
- [x] Set up MongoDB (Mongoose) connection; define initial collections (`users`, `rotation_events`, `password_requests`, `rotation_settings`, `audit_log`) per STYLES.md §2.3 — *pivoted from Prisma + PostgreSQL*
- [x] Set up `docker-compose.yml` for local MongoDB (auth on, single-node replica set) — *pivoted from Postgres*
- [x] Set up ESLint + Prettier + CI (GitHub Actions: lint, typecheck, test)
- [x] Create `.env.example` documenting all required environment variables
- [x] Add a placeholder landing page confirming the app boots

**Checkpoint definition of done:** `npm run dev` boots the app, `npm run build` succeeds, CI passes, and `npm run db:sync` + `npm run test:integration` pass against a fresh MongoDB database (replaces "Prisma migration applies cleanly").

**Session Log:**
- [2026-09-14] [Completed] Scaffolded Next.js 16.3.5 + TypeScript (App Router, `src/`), Tailwind 4, shadcn/ui (base-nova); placeholder landing page; dev server boots and `npm run build` succeeds — `src/app`, `src/components/ui`, `src/lib/utils.ts`, `package.json`, `components.json`
- [2026-09-14] [Completed] ESLint (next + prettier), Prettier (tailwind plugin), Vitest unit tests, `typecheck` script (`next typegen && tsc`); all pass locally — `eslint.config.mjs`, `.prettierrc.json`, `vitest.config.mts`, `src/lib/env.ts`
- [2026-09-14] [Completed] `.env.example` documenting variables for Phases 0, 1, 2 and 4 — `.env.example`
- [2026-09-14] [Pivot] PostgreSQL + Prisma → **MongoDB (Atlas) + Mongoose**, at the project owner's request (local Postgres admin credentials were unavailable). Prisma 7 has no supported MongoDB runtime, so Mongoose is used instead. No migrations: schemas use `strict: "throw"` and `npm run db:sync` creates collections/indexes. Database must be a replica set (transactions). Downstream: Phases 1–5 use `@/lib/db` models; references between collections are not DB-enforced, so integrity checks belong in app code/tests; Phase 2's Auth.js setup must not use the Prisma adapter. STYLES.md §2.3/§2.8/§3/§4 updated — `src/lib/db/`, `scripts/db-sync.ts`, `docker-compose.yml`, `STYLES.md`
- [2026-09-14] [Pivot] JWT sessions + immediate revocation: added `users.tokenVersion` and a `PENDING` status. Guards must check `status === ACTIVE` and a matching `tokenVersion` from the DB on every protected request; revoke/role change/password reset increments it. Affects Phase 2 guards and revoke — `src/lib/db/models.ts`, `STYLES.md` §2.4
- [2026-09-14] [Completed] Mongoose connection + models for all five collections, `db:sync`, unit tests (schema validation) and integration tests (unique email, hash not selected by default, multi-document transactions, isolated `netguard_test` DB) — `src/lib/db/`, `scripts/db-sync.ts`
- [2026-09-14] [Completed] GitHub Actions CI: lint, format check, typecheck, unit tests, build, plus a job that starts `docker-compose.yml` MongoDB, runs `db:sync` and integration tests. First run green (run 34875977587). Repo: github.com/Hax905/Pass-code — `.github/workflows/ci.yml`
- [2026-09-14] [Completed] **Phase 0 checkpoint met.** Verified against the project owner's MongoDB Atlas cluster: `db:sync` created all collections/indexes in database `passcode`, and `test:integration` passes (4/4, isolated `netguard_test` DB) — `.env` (local only)
- [2026-09-14] [Pivot] Local `.env` uses Atlas's standard `mongodb://host1,host2,host3/?tls=true&replicaSet=…&authSource=admin` URI instead of `mongodb+srv://`: Node on this Windows machine can't read the system DNS config for SRV lookups (`querySrv ECONNREFUSED`, Node falls back to 127.0.0.1). No code change; documented in README — `README.md`
- [2026-09-14] [Completed] Pinned install-script approvals for build tooling in `package.json` `allowScripts` (npm 12 blocks unapproved install scripts) — `package.json`

---

## Phase 1 — Rotation Engine
*Goal: password rotation works end-to-end, independently of any UI.*

- [x] Implement password generator (strong, configurable length/character set)
- [x] Implement `RouterAdapter` interface per STYLES.md §1
- [x] Implement `MockRouterAdapter` (v1 default): "applies" the password by storing it for admin manual application
- [x] Implement rotation scheduler using node-cron, reading frequency/window from `rotation_settings` — *a 1-minute tick evaluates the settings (see pivot)*
- [x] Implement rotation execution: generate → store encrypted → apply via adapter → log to `rotation_events` — *store now happens before apply (see pivot)*
- [x] Implement manual "rotate now" function (callable independent of schedule)
- [x] Implement rotation failure handling (retry once, then mark `rotation_events.status = failed`, no silent failure)
- [x] Write unit tests: generator, scheduler logic, mock adapter, failure path
- [x] CLI or internal script to trigger a rotation manually, for testing without a UI

**Checkpoint definition of done:** Running the manual rotation trigger produces a new encrypted password, a `rotation_events` row, and is independently testable without any frontend code existing yet.

**Session Log:**
- [2026-09-16] [Completed] Password generator (CSPRNG, 12–63 chars, default 20, every enabled class present, look-alike characters and awkward symbols excluded) — `src/features/rotation/password-generator.ts`
- [2026-09-16] [Completed] AES-256-GCM encryption at rest (`v1:iv:tag:ciphertext`, tamper-evident); `getRotationEnv()` validates `NETGUARD_ENCRYPTION_KEY` (32 bytes, base64), `ROUTER_ADAPTER`, `ROTATION_SCHEDULER_ENABLED` — `src/lib/crypto/secret-box.ts`, `src/lib/env.ts`, `.env.example`
- [2026-09-16] [Completed] `RouterAdapter` interface (`applyPassword` → `{ manualApplicationRequired }`; error messages must not contain the password) + `createRouterAdapter`; `MockRouterAdapter` keeps only a SHA-256 fingerprint in memory and can simulate failures — `src/features/rotation/router-adapter.ts`, `mock-router-adapter.ts`
- [2026-09-16] [Completed] Rotation execution + manual "rotate now": `rotateNetworkPassword()` (2 attempts, 30 s timeout per attempt, password redacted from error messages, outcome + `audit_log` entry written in one transaction), `getCurrentNetworkPassword()` (latest SUCCEEDED only; callers must log the disclosure), `failStaleRotations()` (PENDING > 10 min → FAILED) — `src/features/rotation/rotation-service.ts`
- [2026-09-16] [Completed] Scheduler: `runScheduledRotationCheck()` + `startRotationScheduler()` (node-cron, every minute, `noOverlap`); interval in hours/days/weeks, optional local-time window (may wrap midnight), 30 min back-off after a failure; does nothing until a `rotation_settings` document exists. Runs in-app via `src/instrumentation.ts` when `ROTATION_SCHEDULER_ENABLED=true`, or standalone with `npm run rotation:worker` — `src/features/rotation/schedule.ts`, `scheduler.ts`, `src/instrumentation.ts`, `scripts/rotation-worker.ts`
- [2026-09-16] [Completed] CLI `npm run rotate` (prints the outcome, never the password; exit code 1 on failure) — `scripts/rotate.ts`, `package.json`
- [2026-09-16] [Completed] Tests: unit (generator, encryption, schedule/window logic, mock adapter, retry/timeout/redaction, env), 46 passing; integration (success, retry, failure keeps previous password current, concurrent rotation refused, stale cleanup, scheduler not-configured/due/not-yet-due/disabled/back-off), 13 passing — `src/features/rotation/*.test.ts`, `src/lib/crypto/secret-box.test.ts`, `src/lib/env.test.ts`
- [2026-09-16] [Pivot] **The encrypted password is stored before it is applied** (task originally said generate → apply → store). If the process dies after the router accepted a password, the password is still recoverable from the (then FAILED) event. Only SUCCEEDED events count as the current password. Affects Phase 3 (a FAILED event may hold a password that reached the router) and Phase 5 (hardware-unreachable edge case) — `src/features/rotation/rotation-service.ts`
- [2026-09-16] [Pivot] **The scheduler is a 1-minute tick, not one cron expression per interval** (cron cannot express "every N weeks"). Nothing rotates until rotation settings are saved, so Phase 3's settings save is what starts scheduled rotation. Only one rotation can be PENDING at a time (partial unique index `one_pending_rotation` → `RotationInProgressError`), which also covers several app instances. Run `npm run db:sync` after pulling — `src/features/rotation/scheduler.ts`, `src/lib/db/models.ts`
- [2026-09-16] [Pivot] `rotation_events` gained `manualApplicationRequired`; `triggeredBy` is absent for scheduled and CLI rotations (the CLI is recorded as `metadata.source = "cli"` in `audit_log`). Phase 3's "rotate now" button should pass `triggeredBy` (the admin's id) and a `source` such as `"admin-ui"` — `src/lib/db/models.ts`
- [2026-09-16] [Completed] **Phase 1 checkpoint met.** `npm run rotate` against `netguard_test` produced a SUCCEEDED `rotation_events` row with a `v1:` ciphertext and a `rotation.succeeded` audit entry (test data removed afterwards); `db:sync` added the new index to `passcode`; lint, format, typecheck, unit tests, integration tests and build pass; `next start` boots with the in-app scheduler enabled. Network hardware is still unconfirmed, so v1 stays on the mock adapter — `.env` (local only: encryption key added)

---

## Phase 2 — Authentication & Authorization Layer
*Goal: individual identity and role-based access work end-to-end, independently of the chatbot or admin UI.*

- [x] Set up Auth.js with credentials provider per STYLES.md §2.4
- [x] Implement user lifecycle logic on the `users` fields defined in Phase 0 (role, status PENDING/ACTIVE/REVOKED, tokenVersion)
- [x] Implement registration/login flow — *both: admin-provisioned (ACTIVE) and self-register (PENDING until an admin approves)*
- [x] Implement role-based route/API guards (admin-only vs. authenticated-user vs. public) — each guard re-reads the user from the DB and rejects unless `status === ACTIVE` and the session's `tokenVersion` matches (STYLES.md §2.4)
- [x] Implement "revoke user" function (immediate effect, not tied to rotation cycle) — sets `REVOKED`, increments `tokenVersion`, writes `audit_log` in one transaction
- [x] Implement `audit_log` writes for auth-sensitive actions (login, revoke, role change)
- [x] Write tests: login success/failure, guard enforcement, revoke-takes-immediate-effect

**Checkpoint definition of done:** A user can register/be provisioned, log in, and be denied access to a protected test route unless authorized — all testable via API calls without the admin UI or chatbot existing yet.

**Session Log:**
- [2026-09-16] [Completed] Auth.js v5 (`next-auth@5.0.0-beta.32`, the Auth.js line that supports Next 16; pinned exactly because it is a beta) with a credentials provider, JWT sessions (12 h max age) carrying `sub`, `role`, `tokenVersion`; handlers at `/api/auth/*` — `src/auth.ts`, `src/types/next-auth.d.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `.env` (local only: `AUTH_SECRET`, `AUTH_URL`)
- [2026-09-16] [Completed] Passwords: bcrypt (cost 12), 12 characters minimum, 72 bytes maximum (bcrypt ignores anything longer), must not equal the email; unknown emails are checked against a dummy hash so timing doesn't reveal which accounts exist — `src/features/auth/password.ts`
- [2026-09-16] [Completed] User lifecycle: `registerUser` (PENDING), `provisionUser` (ACTIVE), `bootstrapAdmin`, `approveUser`, `revokeUser`, `changeUserRole`, `resetUserPassword`, `listUsers`. Each change and its `audit_log` entry are written in one transaction; revoke, role change and password reset increment `tokenVersion`. Admins cannot revoke or demote themselves or the last active admin — `src/features/auth/users.ts`, `errors.ts`, `types.ts`
- [2026-09-16] [Completed] Login: `authenticateCredentials` audits `auth.login.succeeded` / `auth.login.failed` (with reason, never the password); PENDING/REVOKED status is only revealed after a correct password — `src/features/auth/login.ts`
- [2026-09-16] [Completed] Guards: `authorizeSession` (DB re-read: ACTIVE + matching `tokenVersion`, ADMIN for admin level; refusals of existing sessions audited as `auth.access_denied`) and `withAuth(level, handler)` for route handlers, which also refuses cross-origin state-changing requests and maps user-action errors to HTTP statuses — `src/features/auth/session-guard.ts`, `route-guard.ts`
- [2026-09-16] [Completed] API: `POST /api/register` (public; same 202 answer whether or not the email exists), `GET /api/me` (user; the reference protected route), `GET|POST /api/admin/users`, `POST /api/admin/users/[id]/approve`, `POST /api/admin/users/[id]/revoke` (admin). CLI `npm run user:create-admin -- --email …` (hidden prompt or `NETGUARD_ADMIN_PASSWORD`) — `src/app/api/`, `scripts/create-admin.ts`
- [2026-09-16] [Completed] Tests: unit (password policy/hashing) — 52 unit tests total passing; integration (registration/approval, provisioning, duplicates, login success/failure/lockout, guards 401/403, deleted user, revoke ends the existing session immediately, rollback when the audit write fails, role change and password reset end sessions, self/last-admin protection, listing without secrets) — 29 integration tests total passing — `src/features/auth/*.test.ts`
- [2026-09-16] [Added] **Failed-login throttling** (not in the original task list): 5 failures for an email within 15 minutes lock that email for the rest of the window, even with the right password. Uses `audit_log` (new index `{action, target, createdAt}`; run `npm run db:sync`). Tradeoff: someone who knows an email can keep it locked out; an IP-based limit can be added in Phase 5 — `src/features/auth/login.ts`, `src/lib/db/models.ts`
- [2026-09-16] [Pivot] Role-change and password-reset functions exist with tests, but only approve and revoke have HTTP routes so far; Phase 3 should add routes for role change and password reset through `withAuth("admin", …)`. Admin-provisioned accounts get an initial password from the admin, to be shared out of band, because there is no email in v1 (STYLES.md §1). An invite or forced-change flow is a candidate once email exists — `src/features/auth/users.ts`
- [2026-09-16] [Completed] **Phase 2 checkpoint met.** Against `next start` + `netguard_test`, 23/23 HTTP checks passed: anonymous → 401; register → 202 (also for a duplicate), weak password → 400, cross-origin → 403; pending user → 401; admin login → list/approve (409 on repeat, 404 unknown id); approved user → `/api/me` 200, admin routes 403; wrong password → no session; provisioning 201/409; admin self-revoke 409; revoke → the user's existing session gets 401 immediately and a new login is refused. Test data removed afterwards. Lint, format, typecheck, build (also without `.env`, as in CI) pass; `db:sync` applied the new index to `passcode`. The email/password decision from "Global Open Items" was kept as the STYLES.md default; SSO can be added as another Auth.js provider

---

## Phase 3 — Admin App
*Goal: admin-facing UI for everything built in Phases 1–2.*

- [ ] Admin dashboard shell (role-gated to admin only)
- [ ] Rotation settings UI: configure frequency + rotation window, save to `rotation_settings`
- [ ] Rotation history view: list `rotation_events` with status
- [ ] Manual "rotate now" button wired to Phase 1's function
- [ ] Authorized-user management UI: add/remove/revoke users
- [ ] Password request log view: list `password_requests` (who asked, when, granted/denied)
- [ ] Current password view (marked sensitive, writes to `audit_log` on view) per STYLES.md §1
- [ ] Basic anomaly indicator on the dashboard (e.g., spike in requests) — simple threshold-based, not ML, for v1

**Checkpoint definition of done:** An admin can log in, change rotation frequency, see rotation and request history, and manage authorized users entirely through the UI.

**Session Log:**
- _(empty)_

---

## Phase 4 — Chatbot
*Goal: authenticated users can retrieve the password and get security help through a conversational interface.*

- [ ] Server-side chatbot API route calling Anthropic API per STYLES.md §2.6 (never client-side)
- [ ] Deterministic authorization check *before* any prompt construction — the model never decides who is authorized
- [ ] Password retrieval flow: authenticated + authorized user asks → bot returns current password → write to `password_requests`
- [ ] Denial flow: unauthenticated/unauthorized user asks → bot explains how to become authorized → attempt logged
- [ ] Security Q&A: scoped system prompt covering common questions (why did it change, how to connect, who to contact)
- [ ] Network suggestions: bot can reference the user's own request history for basic personalized tips
- [ ] Rate limiting at the API route level (sliding window against `password_requests`), independent of the model
- [ ] Chat UI (user-facing, role-gated to authenticated users)

**Checkpoint definition of done:** An authenticated authorized user can ask the chatbot for the password and receive it (logged); an unauthorized user cannot, and sees a clear denial with next steps.

**Session Log:**
- _(empty)_

---

## Phase 5 — Observability & Hardening
*Goal: the system is trustworthy under real-world edge cases, not just the happy path.*

- [ ] Anomaly detection: flag unusually high request volume from a single user (possible continued informal sharing)
- [ ] Alerting: admin notification (in-app, per STYLES.md §1) on rotation failure or anomaly
- [ ] Audit log integrity check (append-only pattern, no update/delete on `audit_log` rows)
- [ ] Offboarding flow: confirm a revoked user immediately loses chatbot/app access (test explicitly, not just assumed from Phase 2)
- [ ] Edge case: router/hardware unreachable during rotation — confirm failure path from Phase 1 surfaces correctly in admin UI
- [ ] Edge case: rotation scheduled during an active admin edit to settings — confirm no race condition
- [ ] Load-test the rate limiter with concurrent requests

**Checkpoint definition of done:** All edge cases above have a passing test, and a simulated "revoked user tries to use the app" scenario is confirmed blocked end-to-end.

**Session Log:**
- _(empty)_

---

## Phase 6 — Polish & Launch Readiness
*Goal: ready for real use.*

- [ ] End-to-end tests (Playwright) covering PRD §7 flows A–E
- [ ] Finalize deployment target and deploy (STYLES.md §2.8)
- [ ] Finalize database hosting and run production migration
- [ ] Write a short admin-facing README: how to configure rotation, add/remove users, read logs
- [ ] Write a short user-facing help doc: how to log in and ask the chatbot for the password
- [ ] Confirm the real `RouterAdapter` (non-mock) if hardware API access has been confirmed by this point — otherwise document that v1 ships with the mock adapter and manual application step

**Checkpoint definition of done:** Deployed, documented, and every flow in PRD §7 has passed an end-to-end test against the deployed environment.

**Session Log:**
- _(empty)_

---

## Global Open Items Carried From PRD/Styles

These aren't tasks yet because they need a decision first — check here before starting Phase 1 or Phase 2:

- [ ] Confirm network hardware/vendor and whether it exposes a password-change API (affects Phase 1 and Phase 6's final item)
- [ ] Confirm auth model: stay with email/password or move to SSO before Phase 2 starts (affects Phase 2's data model) — *Phase 2 was built on the email/password default (2026-09-16); SSO would be an additional Auth.js provider, and `passwordHash` is already optional*
- [ ] Confirm whether admins should be able to view the raw current password, or only confirm rotation status (affects Phase 3)

---

**Next document in this project set:**
- **Detailed Prompt** — role/problem/solution/action/limitations prompt for driving Claude Code sessions using this file
