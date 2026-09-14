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
- [2026-09-14] [Completed] **Phase 0 checkpoint met.** Note: the project owner's Atlas cluster was not yet exercised locally (connection string not yet in the local `.env`); run `npm run db:sync && npm run test:integration` once it is
- [2026-09-14] [Completed] Pinned install-script approvals for build tooling in `package.json` `allowScripts` (npm 12 blocks unapproved install scripts) — `package.json`

---

## Phase 1 — Rotation Engine
*Goal: password rotation works end-to-end, independently of any UI.*

- [ ] Implement password generator (strong, configurable length/character set)
- [ ] Implement `RouterAdapter` interface per STYLES.md §1
- [ ] Implement `MockRouterAdapter` (v1 default): "applies" the password by storing it for admin manual application
- [ ] Implement rotation scheduler using node-cron, reading frequency/window from `rotation_settings`
- [ ] Implement rotation execution: generate → apply via adapter → store encrypted → log to `rotation_events`
- [ ] Implement manual "rotate now" function (callable independent of schedule)
- [ ] Implement rotation failure handling (retry once, then mark `rotation_events.status = failed`, no silent failure)
- [ ] Write unit tests: generator, scheduler logic, mock adapter, failure path
- [ ] CLI or internal script to trigger a rotation manually, for testing without a UI

**Checkpoint definition of done:** Running the manual rotation trigger produces a new encrypted password, a `rotation_events` row, and is independently testable without any frontend code existing yet.

**Session Log:**
- _(empty)_

---

## Phase 2 — Authentication & Authorization Layer
*Goal: individual identity and role-based access work end-to-end, independently of the chatbot or admin UI.*

- [ ] Set up Auth.js with credentials provider per STYLES.md §2.4
- [ ] Implement user lifecycle logic on the `users` fields defined in Phase 0 (role, status PENDING/ACTIVE/REVOKED, tokenVersion)
- [ ] Implement registration/login flow (admin-provisioned or self-register + admin approval — confirm which per STYLES.md §1)
- [ ] Implement role-based route/API guards (admin-only vs. authenticated-user vs. public) — each guard re-reads the user from the DB and rejects unless `status === ACTIVE` and the session's `tokenVersion` matches (STYLES.md §2.4)
- [ ] Implement "revoke user" function (immediate effect, not tied to rotation cycle) — sets `REVOKED`, increments `tokenVersion`, writes `audit_log` in one transaction
- [ ] Implement `audit_log` writes for auth-sensitive actions (login, revoke, role change)
- [ ] Write tests: login success/failure, guard enforcement, revoke-takes-immediate-effect

**Checkpoint definition of done:** A user can register/be provisioned, log in, and be denied access to a protected test route unless authorized — all testable via API calls without the admin UI or chatbot existing yet.

**Session Log:**
- _(empty)_

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
- [ ] Confirm auth model: stay with email/password or move to SSO before Phase 2 starts (affects Phase 2's data model)
- [ ] Confirm whether admins should be able to view the raw current password, or only confirm rotation status (affects Phase 3)

---

**Next document in this project set:**
- **Detailed Prompt** — role/problem/solution/action/limitations prompt for driving Claude Code sessions using this file
