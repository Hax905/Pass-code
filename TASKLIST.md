# Task List — PassCode
## Project: Automated Network Password Rotation & Access Assistant

**Version:** 1.0
**Companion to:** PRD.md, STYLES.md
**Last updated:** 2026-09-20

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
- [2026-09-14] [Completed] Mongoose connection + models for all five collections, `db:sync`, unit tests (schema validation) and integration tests (unique email, hash not selected by default, multi-document transactions, isolated `passcode_test` DB) — `src/lib/db/`, `scripts/db-sync.ts`
- [2026-09-14] [Completed] GitHub Actions CI: lint, format check, typecheck, unit tests, build, plus a job that starts `docker-compose.yml` MongoDB, runs `db:sync` and integration tests. First run green (run 34875977587). Repo: github.com/Hax905/Pass-code — `.github/workflows/ci.yml`
- [2026-09-14] [Completed] **Phase 0 checkpoint met.** Verified against the project owner's MongoDB Atlas cluster: `db:sync` created all collections/indexes in database `passcode`, and `test:integration` passes (4/4, isolated `passcode_test` DB) — `.env` (local only)
- [2026-09-14] [Pivot] Local `.env` uses Atlas's standard `mongodb://host1,host2,host3/?tls=true&replicaSet=…&authSource=admin` URI instead of `mongodb+srv://`: Node on this Windows machine can't read the system DNS config for SRV lookups (`querySrv ECONNREFUSED`, Node falls back to 127.0.0.1). No code change; documented in README — `README.md`
- [2026-09-14] [Completed] Pinned install-script approvals for build tooling in `package.json` `allowScripts` (npm 12 blocks unapproved install scripts) — `package.json`

---

## Phase 1 — Rotation Engine
*Goal: password rotation works end-to-end, independently of any UI.*

- [x] Implement password generator (strong, configurable length/character set)
- [x] Implement `RouterAdapter` interface per STYLES.md §1
- [x] Implement `MockRouterAdapter` (v1 default): "applies" the password by storing it for admin manual application — *now the virtual router, which applies it immediately (see 2026-09-16 pivot)*
- [x] Implement rotation scheduler using node-cron, reading frequency/window from `rotation_settings` — *a 1-minute tick evaluates the settings (see pivot)*
- [x] Implement rotation execution: generate → store encrypted → apply via adapter → log to `rotation_events` — *store now happens before apply (see pivot)*
- [x] Implement manual "rotate now" function (callable independent of schedule)
- [x] Implement rotation failure handling (retry once, then mark `rotation_events.status = failed`, no silent failure)
- [x] Write unit tests: generator, scheduler logic, mock adapter, failure path
- [x] CLI or internal script to trigger a rotation manually, for testing without a UI

**Checkpoint definition of done:** Running the manual rotation trigger produces a new encrypted password, a `rotation_events` row, and is independently testable without any frontend code existing yet.

**Session Log:**
- [2026-09-16] [Completed] Password generator (CSPRNG, 12–63 chars, default 20, every enabled class present, look-alike characters and awkward symbols excluded) — `src/features/rotation/password-generator.ts`
- [2026-09-16] [Completed] AES-256-GCM encryption at rest (`v1:iv:tag:ciphertext`, tamper-evident); `getRotationEnv()` validates `PASSCODE_ENCRYPTION_KEY` (32 bytes, base64), `ROUTER_ADAPTER`, `ROTATION_SCHEDULER_ENABLED` — `src/lib/crypto/secret-box.ts`, `src/lib/env.ts`, `.env.example`
- [2026-09-16] [Completed] `RouterAdapter` interface (`applyPassword` → `{ manualApplicationRequired }`; error messages must not contain the password) + `createRouterAdapter`; `MockRouterAdapter` keeps only a SHA-256 fingerprint in memory and can simulate failures — `src/features/rotation/router-adapter.ts`, `mock-router-adapter.ts`
- [2026-09-16] [Completed] Rotation execution + manual "rotate now": `rotateNetworkPassword()` (2 attempts, 30 s timeout per attempt, password redacted from error messages, outcome + `audit_log` entry written in one transaction), `getCurrentNetworkPassword()` (latest SUCCEEDED only; callers must log the disclosure), `failStaleRotations()` (PENDING > 10 min → FAILED) — `src/features/rotation/rotation-service.ts`
- [2026-09-16] [Completed] Scheduler: `runScheduledRotationCheck()` + `startRotationScheduler()` (node-cron, every minute, `noOverlap`); interval in hours/days/weeks, optional local-time window (may wrap midnight), 30 min back-off after a failure; does nothing until a `rotation_settings` document exists. Runs in-app via `src/instrumentation.ts` when `ROTATION_SCHEDULER_ENABLED=true`, or standalone with `npm run rotation:worker` — `src/features/rotation/schedule.ts`, `scheduler.ts`, `src/instrumentation.ts`, `scripts/rotation-worker.ts`
- [2026-09-16] [Completed] CLI `npm run rotate` (prints the outcome, never the password; exit code 1 on failure) — `scripts/rotate.ts`, `package.json`
- [2026-09-16] [Completed] Tests: unit (generator, encryption, schedule/window logic, mock adapter, retry/timeout/redaction, env), 46 passing; integration (success, retry, failure keeps previous password current, concurrent rotation refused, stale cleanup, scheduler not-configured/due/not-yet-due/disabled/back-off), 13 passing — `src/features/rotation/*.test.ts`, `src/lib/crypto/secret-box.test.ts`, `src/lib/env.test.ts`
- [2026-09-16] [Pivot] **The encrypted password is stored before it is applied** (task originally said generate → apply → store). If the process dies after the router accepted a password, the password is still recoverable from the (then FAILED) event. Only SUCCEEDED events count as the current password. Affects Phase 3 (a FAILED event may hold a password that reached the router) and Phase 5 (hardware-unreachable edge case) — `src/features/rotation/rotation-service.ts`
- [2026-09-16] [Pivot] **The scheduler is a 1-minute tick, not one cron expression per interval** (cron cannot express "every N weeks"). Nothing rotates until rotation settings are saved, so Phase 3's settings save is what starts scheduled rotation. Only one rotation can be PENDING at a time (partial unique index `one_pending_rotation` → `RotationInProgressError`), which also covers several app instances. Run `npm run db:sync` after pulling — `src/features/rotation/scheduler.ts`, `src/lib/db/models.ts`
- [2026-09-16] [Pivot] `rotation_events` gained `manualApplicationRequired`; `triggeredBy` is absent for scheduled and CLI rotations (the CLI is recorded as `metadata.source = "cli"` in `audit_log`). Phase 3's "rotate now" button should pass `triggeredBy` (the admin's id) and a `source` such as `"admin-ui"` — `src/lib/db/models.ts`
- [2026-09-16] [Completed] **Phase 1 checkpoint met.** `npm run rotate` against `passcode_test` produced a SUCCEEDED `rotation_events` row with a `v1:` ciphertext and a `rotation.succeeded` audit entry (test data removed afterwards); `db:sync` added the new index to `passcode`; lint, format, typecheck, unit tests, integration tests and build pass; `next start` boots with the in-app scheduler enabled. Network hardware is still unconfirmed, so v1 stays on the mock adapter — `.env` (local only: encryption key added)

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
- [2026-09-16] [Completed] API: `POST /api/register` (public; same 202 answer whether or not the email exists), `GET /api/me` (user; the reference protected route), `GET|POST /api/admin/users`, `POST /api/admin/users/[id]/approve`, `POST /api/admin/users/[id]/revoke` (admin). CLI `npm run user:create-admin -- --email …` (hidden prompt or `PASSCODE_ADMIN_PASSWORD`) — `src/app/api/`, `scripts/create-admin.ts`
- [2026-09-16] [Completed] Tests: unit (password policy/hashing) — 52 unit tests total passing; integration (registration/approval, provisioning, duplicates, login success/failure/lockout, guards 401/403, deleted user, revoke ends the existing session immediately, rollback when the audit write fails, role change and password reset end sessions, self/last-admin protection, listing without secrets) — 29 integration tests total passing — `src/features/auth/*.test.ts`
- [2026-09-16] [Added] **Failed-login throttling** (not in the original task list): 5 failures for an email within 15 minutes lock that email for the rest of the window, even with the right password. Uses `audit_log` (new index `{action, target, createdAt}`; run `npm run db:sync`). Tradeoff: someone who knows an email can keep it locked out; an IP-based limit can be added in Phase 5 — `src/features/auth/login.ts`, `src/lib/db/models.ts`
- [2026-09-16] [Pivot] Role-change and password-reset functions exist with tests, but only approve and revoke have HTTP routes so far; Phase 3 should add routes for role change and password reset through `withAuth("admin", …)`. Admin-provisioned accounts get an initial password from the admin, to be shared out of band, because there is no email in v1 (STYLES.md §1). An invite or forced-change flow is a candidate once email exists — `src/features/auth/users.ts`
- [2026-09-16] [Completed] **Phase 2 checkpoint met.** Against `next start` + `passcode_test`, 23/23 HTTP checks passed: anonymous → 401; register → 202 (also for a duplicate), weak password → 400, cross-origin → 403; pending user → 401; admin login → list/approve (409 on repeat, 404 unknown id); approved user → `/api/me` 200, admin routes 403; wrong password → no session; provisioning 201/409; admin self-revoke 409; revoke → the user's existing session gets 401 immediately and a new login is refused. Test data removed afterwards. Lint, format, typecheck, build (also without `.env`, as in CI) pass; `db:sync` applied the new index to `passcode`. The email/password decision from "Global Open Items" was kept as the STYLES.md default; SSO can be added as another Auth.js provider
- [2026-09-16] [Pivot] **Project renamed from NetGuard to PassCode** at the project owner's request, everywhere: docs, page title and heading, package name, and identifiers. Env vars are now `PASSCODE_ENCRYPTION_KEY` and `PASSCODE_ADMIN_PASSWORD` (existing `.env` files must rename the key; the value stays the same). Default DB name is `passcode`, the integration-test DB is `passcode_test`, and the docker-compose user/volume are `passcode`/`passcode-mongodata` (an existing local `netguard-mongodata` volume is no longer used). Earlier log entries were updated to the new names — all files

---

## Phase 3 — Admin App
*Goal: admin-facing UI for everything built in Phases 1–2.*

- [x] Admin dashboard shell (role-gated to admin only)
- [x] Rotation settings UI: configure frequency + rotation window, save to `rotation_settings`
- [x] Rotation history view: list `rotation_events` with status
- [x] Manual "rotate now" button wired to Phase 1's function
- [x] Authorized-user management UI: add/remove/revoke users — *"remove" is revoke (records are kept for the audit trail); also approve, reinstate, role change, password reset*
- [x] Password request log view: list `password_requests` (who asked, when, granted/denied)
- [x] Current password view (marked sensitive, writes to `audit_log` on view) per STYLES.md §1
- [x] Basic anomaly indicator on the dashboard (e.g., spike in requests) — simple threshold-based, not ML, for v1
- [x] Click through the interactive admin UI in a browser (sign in, settings, rotate now, reveal, user management) — *done by the project owner against the sample data*

**Checkpoint definition of done:** An admin can log in, change rotation frequency, see rotation and request history, and manage authorized users entirely through the UI.

**Session Log:**
- [2026-09-16] [Completed] Sign-in, request-access and home pages (Auth.js `signIn` from a server action; login error codes shown as readable messages; `next` redirect limited to same-site paths). Signed-in admins land on `/admin`; other users see a placeholder until Phase 4 — `src/app/(auth)/`, `src/app/page.tsx`, `src/lib/safe-redirect.ts`, `src/features/auth/password-rules.ts`
- [2026-09-16] [Completed] Data access layer: `getSessionUser`, `requirePageAccess(level, path)` (visitors → `/login?next=…`, non-admins → `/?denied=admin`, refusal audited) and `requireActionAccess` for server actions. The admin layout is only a shell; every page and every action checks access itself (Next.js guidance: layouts don't re-render on navigation) — `src/features/auth/dal.ts`, `src/app/admin/layout.tsx`
- [2026-09-16] [Completed] Dashboard: rotation status (schedule, last rotation, current password age, next due), alerts, reveal-password card (confirmation dialog, `password.viewed` audit entry written before the password is returned, hides after 60 s) and rotate-now button — `src/app/admin/page.tsx`, `src/features/admin/components/`, `src/features/rotation/rotation-service.ts` (`revealCurrentPassword`)
- [2026-09-16] [Completed] Rotation page: settings form (enabled, interval in hours/days/weeks, optional window that may cross midnight, time zone) and history table. `saveRotationSettings` validates with Zod (1 hour to 1 year, both window ends or neither, valid time zone), uses a version check so two admins can't silently overwrite each other, and audits before/after values — `src/app/admin/rotation/page.tsx`, `src/features/rotation/settings.ts`
- [2026-09-16] [Completed] Users page: status filter, add user, approve/reject, revoke with an optional reason, reinstate, make admin/user, reset password. New `reinstateUser` (REVOKED → ACTIVE, bumps `tokenVersion` so old sessions stay invalid) and API routes `POST /api/admin/users/[id]/role|password|reinstate` — `src/app/admin/users/page.tsx`, `src/features/auth/users.ts`, `src/app/api/admin/users/[id]/`
- [2026-09-16] [Completed] Password requests page (granted/denied filter, requester email, denial reason, IP) and anomaly indicators: a user with more than 5 granted requests in 24 h, 10+ denials in 1 h, 20+ failed sign-ins in 1 h, a failed last rotation, a password waiting to be applied by hand, accounts waiting for approval — `src/app/admin/requests/page.tsx`, `src/features/admin/activity.ts`
- [2026-09-16] [Completed] Tests: 57 unit (adds time/schedule formatting and redirect safety) and 41 integration (adds settings create/update/conflict/validation, status and history, audited reveal, reinstate, request log, anomaly thresholds and time windows). Production build passes. HTTP check against `next start` + `passcode_test`: 43/44 passed; the one failure was the check itself (React inserts `<!-- -->` between "by" and the email) — `src/features/admin/*.test.ts`
- [2026-09-16] [Pivot] **Admin UI uses Server Components for reads and Server Actions for changes, not React Query** (STYLES.md §2.1). Each action re-renders the page with fresh data in the same round trip, so no client-side cache is needed, and all authorization stays on the server. React Query remains available for Phase 4's chat UI if it needs client-side state — `src/app/admin/actions.ts`, `STYLES.md`
- [2026-09-16] [Pivot] shadcn/ui components added: alert, alert-dialog, badge, card, dialog, input, label, native-select, separator, table (base-nova style, built on Base UI: use the `render` prop instead of `asChild`) — `src/components/ui/`
- [2026-09-16] [Completed] **Phase 3 checkpoint met.** The project owner tested the admin UI in a browser against sample data on `next start` (`passcode_test`, scheduler on): requested an account, had it approved and promoted to admin (which ended the old session as designed), and confirmed the admin app works
- [2026-09-16] [Pivot] **Virtual router only.** At the project owner's request (avoid bloat, save time), PassCode will never support physical routers. `MockRouterAdapter` is now the virtual router: it applies each password immediately (`manualApplicationRequired: false`, error text "Virtual router: …"). Removed the dashboard alert about entering the password on the router, and the history now says "Applied to the virtual router". The `manualApplicationRequired` field stays for existing records. PRD, STYLES, README, `.env.example` updated; the Global Open Items hardware question is closed — `src/features/rotation/mock-router-adapter.ts`, `src/features/admin/activity.ts`, `src/app/admin/rotation/page.tsx`, `src/features/admin/components/reveal-password.tsx`
- [2026-09-16] [Completed] Database health check on the project owner's Atlas cluster: replica set `atlas-149hwp-shard-0` (3 hosts, writable primary, MongoDB 8.0.32, AWS us-east-1), transactions supported, round trips 67–164 ms; `passcode` has all 5 collections with indexes matching the schemas (no data yet, no admin yet). Integration tests now share `src/test/integration-db.ts`, which reads `TEST_DATABASE_NAME` (default `passcode_test`) and refuses names that don't end in `_test` — `src/test/integration-db.ts`, `src/**/*.integration.test.ts`, `README.md`

---

## Phase 4 — Chatbot
*Goal: authenticated users can retrieve the password and get security help through a conversational interface.*

- [x] Server-side chatbot API route calling Anthropic API per STYLES.md §2.6 (never client-side)
- [x] Deterministic authorization check *before* any prompt construction — the model never decides who is authorized
- [x] Password retrieval flow: authenticated + authorized user asks → bot returns current password → write to `password_requests` — *the password is shown in a separate panel; the model never sees it (see pivot)*
- [x] Denial flow: unauthenticated/unauthorized user asks → bot explains how to become authorized → attempt logged — *fixed answer, no model call*
- [x] Security Q&A: scoped system prompt covering common questions (why did it change, how to connect, who to contact)
- [x] Network suggestions: bot can reference the user's own request history for basic personalized tips
- [x] Rate limiting at the API route level (sliding window against `password_requests`), independent of the model
- [x] Chat UI (user-facing, role-gated to authenticated users) — *page is open to everyone; the API decides (see pivot)*
- [x] Live check against the real model API: `npm run chat:live-check` — *run against Gemini on 2026-09-20, 17/17 checks (see Phase 6)*

**Checkpoint definition of done:** An authenticated authorized user can ask the chatbot for the password and receive it (logged); an unauthorized user cannot, and sees a clear denial with next steps.

**Session Log:**
- [2026-09-16] [Completed] `POST /api/chat`: same-origin check → `resolveChatAccess` (ACTIVE user with current `tokenVersion`, straight from the database) → per-user message limit (20 per 10 min, in memory) → Zod-validated text-only history (≤ 20 turns, ≤ 2000 chars each, alternating, ending with the user) → `runChatTurn`. Responses are `Cache-Control: no-store`; Anthropic errors become a friendly 503 — `src/app/api/chat/route.ts`, `src/features/chat/access.ts`, `src/features/chat/rate-limit.ts`
- [2026-09-16] [Completed] Chat turn: `@anthropic-ai/sdk` 0.126, `claude-opus-5` (adaptive thinking by default, `effort: "low"` for short chat answers), server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), strict tools `show_network_password`, `get_rotation_info`, `get_my_password_requests`, at most 5 tool rounds, fixed reply on `refusal` — `src/features/chat/chat-service.ts`, `src/features/chat/prompt.ts`
- [2026-09-16] [Completed] Password gate `requestNetworkPassword`: re-reads the user (status + `tokenVersion`) at the moment of the request, allows 3 grants per user per rolling hour, logs every outcome to `password_requests` (granted, `REVOKED`, `NOT_AUTHORIZED`, `RATE_LIMITED`); at most one reveal per chat turn — `src/features/chat/password-access.ts`
- [2026-09-16] [Completed] Chat UI at `/chat`: suggestions, password panel with copy button that hides after 60 s and is never sent back to the server, sign-in / request-access buttons on denial. Signed-in users land on `/chat`; admins get an "Assistant" link — `src/app/chat/`, `src/app/page.tsx`, `src/app/admin/admin-nav.tsx`
- [2026-09-16] [Completed] Optional env `PASSCODE_NETWORK_NAME` and `PASSCODE_SUPPORT_CONTACT` personalise answers — `src/lib/env.ts`, `.env.example`
- [2026-09-16] [Completed] Tests: 63 unit (history validation, limiter, prompt/tools, denial text) and 58 integration (adds access gate, password gate, rate limit with retry time, mid-conversation revocation, one reveal per turn, own-data-only tool results, refusal, tool-round cap; a fake Claude client records every request and the tests assert the password never appears in any of them) — `src/features/chat/*.test.ts`. The Phase 1 "second rotation" test now waits up to 10 s for Atlas instead of 1 s
- [2026-09-16] [Pivot] **The model never sees the password.** `show_network_password` returns only "shown" / "not shown" to the model; the password travels to the browser in a separate `reveal` field. Prompt injection therefore can't make the model leak it, and no password is sent to Anthropic — `src/features/chat/chat-service.ts`
- [2026-09-16] [Pivot] **`/chat` is open to everyone, and people who aren't signed in (or are revoked) never reach the model.** The API answers them with a fixed explanation plus sign-in / request-access buttons and logs a denied request (at most 10 per address or user per 10 minutes, so the log can't be flooded). PRD §6.3 would allow generic Q&A for anonymous visitors; left out to keep cost and abuse surface down — `src/features/chat/access.ts`, `src/app/chat/page.tsx`
- [2026-09-16] [Pivot] Chat message limit is in memory, so each server instance counts separately; the password limit itself is in the database and holds across instances. Two simultaneous reveals can slip past the 3-per-hour limit by one — `src/features/chat/rate-limit.ts`, `src/features/chat/password-access.ts`
- [2026-09-16] [Completed] HTTP check against `next start` + `passcode_test` (no API key): 16/16 passed — `/chat` renders for visitors and signed-in users; anonymous ask → 401 with the fixed explanation, logged, `no-store`; cross-origin → 403; revoked account → 401; malformed history and smuggled `tool_result` → 400; missing API key → friendly 503 with no `reveal`. Fixed on the way: the SDK reports missing credentials with a plain `Error`, so the route now turns every unexpected failure into the 503 reply (details go to the server log). Full integration suite: 58/58 (one earlier run timed out in a setup hook while Atlas was slow) — `src/app/api/chat/route.ts`
- [2026-09-16] [Blocked] Checkpoint not declared met yet: no `ANTHROPIC_API_KEY` is configured, so the real model hasn't been called (see the unchecked task above)
- [2026-09-20] [Pivot] **The chatbot runs on Google Gemini by default, behind a provider seam.** At the project owner's request (the Anthropic API needs paid credits; Gemini has a free tier), the model now sits behind a vendor-neutral `ChatModelProvider`/`ChatModelSession` (`src/features/chat/providers/`). `runChatTurn` no longer knows any vendor: it asks the session for a reply, runs the tools itself and hands back results. The authorization gate, the 3-per-hour password limit, the tools and the "model never sees the password" property are unchanged and still live in our code. Both providers ship — `CHAT_PROVIDER=gemini` (default, `@google/genai` 2.23) or `anthropic` — so the Phase 4 Claude path is kept, not deleted. Tradeoff recorded for PRD §8: Google's free tier may use submitted content for product improvement, so chat text and display names (never the password, never credentials) reach a provider with weaker data handling than the paid tier — `src/features/chat/providers/`, `chat-service.ts`, `history.ts`, `prompt.ts`, `src/app/api/chat/route.ts`, `src/lib/env.ts`, `STYLES.md` §2.6
- [2026-09-20] [Pivot] **Gemini specifics found while building.** A tool call arrives with `finishReason: STOP`, so calls are detected via `functionCalls`, not the finish reason; tool results go back as a `user`-role content with `functionResponse` parts (the SDK's `Content.role` only allows `user`/`model`); blocked answers (`SAFETY`, `PROHIBITED_CONTENT`, …) map to the same fixed refusal reply as Anthropic's `refusal`. The stateless `models.generateContent` is used rather than the newer server-stateful `interactions` API, so no conversation state is kept at the provider. The free tier answers **503 UNAVAILABLE per model under load** (observed on `gemini-3.8-flash` and `gemini-3.5-flash` within minutes of each other, and `gemini-2.5-flash` is retired: 404 although still listed), so `GEMINI_MODELS` is a list tried in order, twice, before a retryable error surfaces as the friendly 503 reply — `src/features/chat/providers/gemini.ts`, `.env.example`
- [2026-09-20] [Completed] Tests reworked for the seam: the Anthropic-shaped fake client became a provider-neutral fake (simpler, and it covers the shared loop), and a new `providers.test.ts` asserts each vendor's actual wire format — Anthropic's `betas`/`fallbacks`/`effort`/`strict` tools and verbatim echo of thinking blocks, Gemini's `contents`/`functionDeclarations`/`functionResponse` round trip, refusal mapping, and the 503 model-walk. 74 unit tests pass (was 64) — `src/features/chat/providers.test.ts`, `chat.test.ts`, `chat.integration.test.ts`

---

## Phase 5 — Observability & Hardening
*Goal: the system is trustworthy under real-world edge cases, not just the happy path.*

- [x] Anomaly detection: flag unusually high request volume from a single user (possible continued informal sharing) — *built in Phase 3; now also flags users who hit the hourly password limit*
- [x] Alerting: admin notification (in-app, per STYLES.md §1) on rotation failure or anomaly
- [x] Audit log integrity check (append-only pattern, no update/delete on `audit_log` rows)
- [x] Offboarding flow: confirm a revoked user immediately loses chatbot/app access (test explicitly, not just assumed from Phase 2)
- [x] Edge case: virtual router failing during rotation (simulated with `MockRouterAdapter` failure options) — confirm failure path from Phase 1 surfaces correctly in admin UI
- [x] Edge case: rotation scheduled during an active admin edit to settings — confirm no race condition
- [x] Load-test the rate limiter with concurrent requests

**Checkpoint definition of done:** All edge cases above have a passing test, and a simulated "revoked user tries to use the app" scenario is confirmed blocked end-to-end.

**Session Log:**
- [2026-09-18] [Completed] **Password limit is now exact under load.** `requestNetworkPassword` runs as one transaction that also bumps `users.passwordRequestSeq`, so simultaneous requests for the same user conflict and MongoDB runs them one after another. Load test: 20 simultaneous requests → exactly 3 granted, 17 logged `RATE_LIMITED`, 20 log entries — `src/features/chat/password-access.ts`, `src/lib/db/models.ts`
- [2026-09-18] [Completed] **Audit log is append-only.** Mongoose middleware refuses `updateOne/updateMany/replaceOne/findOneAndUpdate/findOneAndReplace/deleteOne/deleteMany/findOneAndDelete`, saves of existing documents, and non-insert `bulkWrite` operations with `AuditLogImmutableError`; inserts are the only allowed write. Tests clear collections through the raw driver via `clearTestDatabase()` — `src/lib/db/models.ts`, `src/test/integration-db.ts`, `src/lib/db/audit-log.integration.test.ts`
- [2026-09-18] [Completed] **In-app alerting on every admin page:** a header badge showing the number of warnings (failed rotation, heavy requester, limit reached, denial or sign-in spikes), plus a one-minute auto-refresh of admin pages so background events appear without a reload (client state such as a half-filled form is kept) — `src/app/admin/admin-alerts.tsx`, `src/app/admin/auto-refresh.tsx`, `src/app/admin/layout.tsx`, `src/features/admin/activity.ts`
- [2026-09-18] [Completed] **Virtual router failure switch for demos and tests:** `VIRTUAL_ROUTER_FAILURE=off|always|first-attempt` (`first-attempt` fails once, the automatic retry succeeds) — `src/lib/env.ts`, `src/features/rotation/router-adapter.ts`, `.env.example`
- [2026-09-18] [Completed] Tests: 64 unit and 74 integration. New: audit-log immutability (14 write paths refused), rate limits under load (20 simultaneous requests, per-user allowances, revocation mid-flight, in-memory burst), rotation edge cases (two simultaneous settings edits → exactly one winner; 6 scheduler ticks overlapping settings saves → exactly one rotation; scheduling off; always-failing router surfaces in status, history and alerts while the old password stays current; fail-once recovers; scheduler backs off then succeeds), and offboarding through the real route handlers with the session and model mocked (revoked user loses `/api/me`, chat, pages, actions, password and sign-in; revoked admin loses the admin app; demotion ends the admin session; visitors get the fixed explanation) — `src/**/*.integration.test.ts`
- [2026-09-18] [Completed] **Phase 5 checkpoint met.** End-to-end against `next start` (separate `passcode_e2e_test` database, scheduler on, `VIRTUAL_ROUTER_FAILURE=always`, no API key): the scheduler's failed rotation appeared on the dashboard with the router error within ~60 s, the alert badge showed on the dashboard and the users page, the rotation history listed the failed attempt, no password was created, and a burst of 30 simultaneous chat requests from one user gave exactly 20 through and 10 rate-limited (429)
- [2026-09-18] [Completed] **Bug found by the new race test and fixed:** two scheduler instances could rotate twice in a row when one finished between the other's read and its own start (the single-rotation index only covers overlapping rotations). `rotateNetworkPassword` now takes `supersededAfter` and aborts with `RotationSupersededError` if a rotation succeeded after the one the decision was based on; the scheduler reports `superseded` — `src/features/rotation/rotation-service.ts`, `src/features/rotation/scheduler.ts`
- [2026-09-18] [Pivot] Append-only is enforced in application code, not by the database: doing it at the database level needs a restricted MongoDB user (no `update`/`delete` on `audit_log`), which is out of scope for a local demo. Anything with direct database access can still edit the collection — noted for Phase 6's demo documentation — `src/lib/db/models.ts`

---

## Phase 6 — Polish & Demo Readiness
*Goal: a functional, repeatable local demo. PassCode is a demo and is not deployed publicly (decided 2026-09-16).*

- [x] End-to-end tests (Playwright) covering PRD §7 flows A–E
- [x] Local demo setup: one command that syncs the database and loads demo accounts and data, plus run instructions (no public deployment)
- [x] Confirm the demo database setup on Atlas (`db:sync` on a clean database)
- [x] Write a short admin-facing README: how to configure rotation, add/remove users, read logs
- [x] Write a short user-facing help doc: how to log in and ask the chatbot for the password
- [x] Document that PassCode ships with the virtual (mock) router only; no physical router support (decided 2026-09-16)
- [x] Live check of the assistant against the real model API (carried over from Phase 4): `npm run chat:live-check`

**Checkpoint definition of done:** The demo can be set up from a fresh clone with the documented steps, it is documented, and every flow in PRD §7 has passed an end-to-end test against a locally running production build.

**Session Log:**
- [2026-09-18] [Completed] **Project health check before starting this phase.** Lint, format, typecheck, build, 64 unit tests, 74 integration tests; `passcode` on Atlas healthy (replica set, all collections, indexes match the schemas); CLI tools work (`db:sync`, `user:create-admin`, `rotate`, `rotate` with a failing router); 39/39 core flows over HTTP (public pages, registration → approval → sign-in, role gates, admin pages, revoke → instant lock-out → reinstate) and 10/10 core service checks (settings saved and audited, password handed over and logged without leaking, audit log refusing changes, password encrypted at rest, rotation status and history); the scheduler rotated and the result appeared in the admin UI. **No core errors.** Two test-only defects fixed: `UID` is read-only in bash (health script), and the rotation-lock test released its pause handle before the adapter had it
- [2026-09-18] [Completed] `npm run demo:seed` loads demo accounts (admin, second admin, two users, a revoked user, one waiting for approval), a 7-day schedule, a failed and a successful rotation, and password requests. It deletes everything first, so it refuses databases whose name doesn't end in `_demo`/`_test` unless `--force` — `scripts/demo-seed.ts`, `package.json`
- [2026-09-18] [Completed] Playwright end-to-end tests covering PRD §7: flow A (admin changes the schedule, sees it saved and on the dashboard), flow B (rotate now → history entry; reveal the current password), flow C (the password appears in its own panel and hides again), flow D (visitor gets the explanation plus sign-in/request-access, and the attempt shows in the request log; a regular user can't reach the admin app), flow E (admin revokes a signed-in user → refused on their next message → reinstated; the dashboard flags a heavy requester). 8/8 pass in ~50 s against a production build on `passcode_e2e_test` — `playwright.config.ts`, `e2e/`, `.gitignore`
- [2026-09-18] [Completed] Guides for both audiences and demo run instructions in the README; CI gained an end-to-end job (MongoDB from docker-compose, generated secrets, Chromium, report uploaded on failure) — `docs/ADMIN.md`, `docs/USER.md`, `README.md`, `.github/workflows/ci.yml`
- [2026-09-18] [Completed] Demo setup verified end to end as documented: seeded `passcode_demo` from empty (collections and indexes created by the seeder), `npm run build`, `npm start` — the dashboard showed the schedule, alerts and pending account; users, requests and rotation pages all rendered the demo data; the seeder refused the real `passcode` database
- [2026-09-18] [Pivot] Flow C's end-to-end test stubs the `/api/chat` response so it doesn't spend API credits or depend on the network; what the password gate itself does (authorization, limit, logging, the model never seeing the password) is covered by the integration tests — `e2e/flows.spec.ts`
- [2026-09-20] [Completed] `npm run chat:live-check` — a repeatable live check against whichever provider `CHAT_PROVIDER` selects. It runs real turns (security Q&A, password retrieval, a history-grounded tip, an out-of-scope request, and with `--full` the hourly limit) with a recording client underneath the provider, and asserts the tool was actually called, the reveal matches the stored password, the grant was logged, and **the password appears in no outbound request**. Refuses any database not ending in `_demo`/`_test`, and removes the log rows it writes — `scripts/chat-live-check.ts`, `package.json`
- [2026-09-20] [Blocked] The live check itself has not been run: MongoDB Atlas refuses connections from this machine (`tlsv1 alert internal error` — the current public IP is not in the cluster's access list), so integration tests, end-to-end tests and the live check cannot reach a database. Docker is not installed, so the local `docker-compose.yml` replica set is not an alternative here. Unblocked by adding the current IP in Atlas → Network Access — **resolved 2026-09-20**, the IP was added to the access list
- [2026-09-20] [Completed] **Phase 6 checkpoint met; the live check passes against the real model.** `npm run chat:live-check -- --full` on `passcode_demo`: **17/17**. Real Gemini turns showed the model calling `show_network_password` and `get_my_password_requests`, the reveal matching the stored password, the grant and the `RATE_LIMITED` refusal both logged, an out-of-scope request (asking for a port-scanning script) declined, an answer returned in the asker's language, and — asserted over every outbound payload of the run — **the password in none of them**. The check removes the rows it writes
- [2026-09-20] [Completed] Full suite re-verified on the Gemini provider seam: lint, Prettier, typecheck, production build, **80 unit** tests, **74 integration** tests against Atlas, and **8/8 Playwright** flows A–E against a production build on `passcode_e2e_test`
- [2026-09-20] [Completed] **Bug found by the live check and fixed: a dropped connection killed the turn.** `fetch failed` (undici's TypeError for a reset socket) carries no HTTP status, so the model walk read it as a permanent error and gave up instead of moving to the next model — two live runs died mid-check. The Gemini provider now follows the `cause` chain and treats transport failures (`fetch failed`, `ECONNRESET`, the `UND_ERR_*` timeouts) as retryable alongside 503/429/500. The Anthropic path is unaffected: its SDK retries transport errors itself — `src/features/chat/providers/gemini.ts`, `src/features/chat/providers.test.ts`
- [2026-09-20] [Completed] **Default Gemini model list widened to five distinct, verified models** (`gemini-3.8-flash`, `-3.7-flash`, `-3.6-flash`, `-3.5-flash`, `-3.5-flash-lite`). Probing every candidate showed `gemini-flash-latest` is an alias of the newest model, so it shared the same exhausted quota and wasted a step in the walk, and `gemini-2.5-flash` is retired — it answers **404, which is not retryable and ended the walk**. The free tier returns 429 (daily quota, per model) as well as the 503 seen earlier, so the list needs real spare capacity to survive a full run — `src/features/chat/providers/gemini.ts`, `.env.example`
- [2026-09-20] [Note] Running the live check twice inside an hour trips the 3-per-hour password limit and fails three of its checks — that is the limit working, not a regression. `npm run demo:seed` resets the request log

---

## Global Open Items Carried From PRD/Styles

These aren't tasks yet because they need a decision first — check here before starting Phase 1 or Phase 2:

- [x] Confirm network hardware/vendor and whether it exposes a password-change API — *decided 2026-09-16: no physical hardware; PassCode uses the virtual (mock) router only*
- [ ] Confirm auth model: stay with email/password or move to SSO before Phase 2 starts (affects Phase 2's data model) — *Phase 2 was built on the email/password default (2026-09-16); SSO would be an additional Auth.js provider, and `passwordHash` is already optional*
- [ ] Confirm whether admins should be able to view the raw current password, or only confirm rotation status (affects Phase 3)

---

**Next document in this project set:**
- **Detailed Prompt** — role/problem/solution/action/limitations prompt for driving Claude Code sessions using this file
