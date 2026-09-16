# Styles Document — Technology & Architecture
## Project: PassCode — Automated Network Password Rotation & Access Assistant

**Version:** 1.0
**Companion to:** PRD.md
**Last updated:** 2026-09-14

---

## 0. How to Use This Document

This document answers the PRD's open questions with concrete defaults so development can start immediately. Every default below is marked **[ASSUMPTION]** where it resolves an open question from the PRD — if any of these don't match your actual environment (especially the network hardware), flag it before Phase 1 starts, since that one has the biggest downstream impact.

---

## 1. Architectural Decisions (resolving PRD §13 Open Questions)

| Open Question | Decision | Rationale |
|---|---|---|
| Single app or two apps? | **Single web app, role-based views** (admin vs. user) | Simpler to build, deploy, and maintain in v1; shared auth system; role gate controls what's visible |
| End-user authentication | **[ASSUMPTION] Email + password accounts, admin-provisioned or self-registered with admin approval**, with the model built so SSO (Google/Microsoft) can be added later without a rewrite | No existing directory confirmed; this is the lowest-dependency starting point |
| Hardware integration | **Decided (2026-09-16): virtual router only.** Rotation goes through the "RouterAdapter" interface, and the only implementation is the virtual (mock) router (`ROUTER_ADAPTER=mock`), which applies each new password immediately. No physical routers are supported, in v1 or the finished product | Avoids bloat and saves time; the interface stays, so it isn't a dead end |
| Password visibility to admins | Admins **can** view the current password in the admin UI (marked as a sensitive action, logged) | Admins need it to help authorized people; every view is audited |
| Directory integration | None in v1 — authorized users are managed manually inside the app | No confirmed existing directory; avoids a hard dependency |
| Notifications | **In-app only for v1** (a banner/notice when a new password is available); email as a fast-follow | Keeps v1 scope tight; avoids setting up email infra before the core loop works |

---

## 2. Technology Stack

### 2.1 Frontend
- **Framework:** Next.js (React, TypeScript)
- **Styling:** Tailwind CSS
- **UI components:** shadcn/ui (accessible, unstyled primitives that fit Tailwind)
- **State/data fetching:** React Query (TanStack Query) for server state. *Pivot (2026-09-16):* the admin app reads data in Server Components and changes it through Server Actions (`src/app/admin/actions.ts`), which re-render the page in the same round trip; React Query is kept for client-heavy screens such as the Phase 4 chat.
- **Access checks in the UI:** pages call `requirePageAccess` and server actions call `requireActionAccess` (`src/features/auth/dal.ts`); layouts are never the only check.
- **Rationale:** Next.js gives us a single deployable app with both the frontend and API routes, which fits the "single app, role-based views" decision above and minimizes moving parts for a small team.

### 2.2 Backend
- **Runtime:** Node.js (TypeScript) via Next.js API routes / Route Handlers
- **Validation:** Zod for request/response schema validation
- **Job scheduling (password rotation):** node-cron for scheduled rotation triggers, wrapped in a service that can later move to a dedicated worker/queue if reliability requirements grow. A 1-minute tick checks `rotation_settings` and rotates when due (cron expressions cannot express "every N weeks"). It runs inside the Next.js server (`src/instrumentation.ts`, `ROTATION_SCHEDULER_ENABLED=true`) or as its own process (`npm run rotation:worker`) on serverless hosts. A partial unique index allows only one rotation in progress at a time.
- **Rationale:** Keeping backend logic in TypeScript alongside the frontend avoids context-switching across languages and keeps the "single app" decision consistent end-to-end.

### 2.3 Database
> **Pivot (2026-09-14):** moved from PostgreSQL + Prisma to MongoDB + Mongoose at the project owner's request. See TASKLIST.md Phase 0 Session Log.

- **Primary datastore:** MongoDB (MongoDB Atlas; `docker-compose.yml` provides an equivalent local single-node replica set with auth enabled)
- **ODM:** Mongoose — models in `src/lib/db/models.ts`. Prisma 7 has no supported MongoDB runtime, so it was not used.
- **Schema changes:** there are no migrations. Schemas are defined in Mongoose with `strict: "throw"`, and `npm run db:sync` creates collections and syncs indexes. Run it after pulling schema changes.
- **Transactions:** the database must be a replica set, because multi-step writes (e.g. revoke user + audit entry) use multi-document transactions.
- **Core collections (high level; names kept from the original table design):**
  - `users` (id, email, role [admin/user], auth fields, status [pending/active/revoked], tokenVersion)
  - `rotation_events` (id, timestamp, triggered_by [scheduled/manual/admin_id], status, password_hash_or_ref)
  - `password_requests` (id, user_id, timestamp, granted [bool])
  - `rotation_settings` (frequency, window_start, window_end, updated_by, updated_at)
  - `audit_log` (id, actor_id, action, target, timestamp, metadata)
- **Rationale:** a single model file keeps the data model in one readable place for every session. Tradeoff accepted with the pivot: MongoDB doesn't enforce references between collections, so integrity checks (e.g. a request's user exists) live in application code and tests.

### 2.4 Authentication
- **Library:** Auth.js (NextAuth) with a credentials provider (email/password) for v1: `next-auth@5` (beta, pinned exactly), configured in `src/auth.ts`
- **Password hashing:** bcrypt (cost 12; passwords must be 12 characters to 72 bytes)
- **Accounts:** self-registration creates PENDING accounts that an admin approves; admins can also provision ACTIVE accounts. The first admin is created with `npm run user:create-admin`.
- **Route protection:** wrap route handlers in `withAuth("user" | "admin", handler)` from `src/features/auth/route-guard.ts`. It performs the database check below and refuses cross-origin state-changing requests. Repeated failed logins lock an email for 15 minutes.
- **Session:** JWT-based sessions via Auth.js. **Every protected request must also load the user from the database and reject the session if `status` isn't `ACTIVE` or the token's `tokenVersion` doesn't match the user's.** A JWT alone stays valid until it expires, which would break PRD §8's requirement that revocation is immediate. Revoking a user, changing their role or resetting their password increments `tokenVersion`.
- **Designed for extension:** Auth.js's provider model means Google/Microsoft SSO can be added later as an additional provider without restructuring the auth system.

### 2.5 Secrets & Sensitive Data
- **Current network password:** stored encrypted at rest (e.g., via a KMS-backed encryption key or, for v1, an application-level encryption key stored outside the repo/env-committed files). v1: AES-256-GCM with `PASSCODE_ENCRYPTION_KEY` (`src/lib/crypto/secret-box.ts`), stored in `rotation_events.passwordCiphertext`.
- **Environment/config secrets:** `.env` (never committed), documented in `.env.example`

### 2.6 Chatbot / AI Layer
- **Provider:** Anthropic API (Claude), called server-side only — never from the client, to avoid exposing API keys and to keep authorization checks in one place
- **Pattern:** The chatbot endpoint always checks the authenticated session and authorization status **before** constructing any prompt that could result in disclosing the password — the AI model is never the thing deciding whether someone is authorized; that's a deterministic check in code first.
- **Scope of chatbot skills (from PRD §6.3):**
  - Password retrieval (gated by the authorization check above)
  - Security Q&A (general knowledge, can be handled with a well-scoped system prompt)
  - Network suggestions (can reference the user's own connection/request history from the database for personalized tips)
- **Rate limiting:** enforced at the API route level (e.g., a simple sliding-window check against `password_requests`), independent of anything the model itself decides.
- **Implementation (2026-09-16):** `POST /api/chat` → `resolveChatAccess` → `runChatTurn` (`src/features/chat/`). Model `claude-opus-5` with `effort: "low"` and the server-side refusal fallback (`fallbacks: "default"`). The password is never given to the model: the `show_network_password` tool calls `requestNetworkPassword` (status and `tokenVersion` re-checked, 3 grants per hour, every outcome logged) and returns only "shown"/"not shown"; the password goes to the browser in a separate `reveal` field. Visitors who aren't signed in, and revoked users, get a fixed answer without any model call.

### 2.7 Testing
- **Unit/integration:** Vitest
- **End-to-end:** Playwright (for the core flows in PRD §7: admin configures rotation, scheduled rotation, user requests password, unauthorized denial)

### 2.8 Deployment & Infrastructure
- **Hosting:** Vercel (fits Next.js natively) or any Node-compatible host — decision not blocking, can be finalized at Phase 6
- **Database hosting:** MongoDB Atlas
- **CI:** GitHub Actions — lint, typecheck, test on every push

---

## 3. Coding Conventions

- **Language:** TypeScript everywhere (frontend, backend, scripts) — no mixed-language surface area, since multiple Claude Code sessions will work across the whole codebase.
- **Linting/formatting:** ESLint + Prettier, enforced in CI.
- **File/folder structure:** feature-based folders (e.g., `/features/rotation`, `/features/chatbot`, `/features/auth`) rather than strictly type-based (`/controllers`, `/models`) — keeps each phase from the PRD's implementation plan mapped to a clear folder a session can own without touching unrelated code.
- **Commits:** Conventional Commits format (`feat:`, `fix:`, `chore:`) so history stays readable across many sessions.
- **Environment parity:** one `docker-compose.yml` for a local MongoDB replica set (optional when using Atlas). CI uses it for integration tests.

---

## 4. Why This Stack Fits the Multi-Session Workflow

- A **single language and framework** (TypeScript/Next.js) means any session can pick up any phase without a context-switch cost.
- **Feature-based folders** mean each PRD phase (rotation engine, auth, admin app, chatbot) maps to a folder a session can work in without touching other phases' code — reducing merge conflicts across sessions.
- **Mongoose models + `db:sync`** give a single source of truth for the data model that every session reads from; CI runs integration tests against a fresh database so schema/index problems surface immediately.
- **The RouterAdapter abstraction** keeps rotation logic independent of the router. PassCode only ships the virtual (mock) router, which can also simulate failures for tests.

---

**Next document in this project set:**
- **Task List** — phase-by-phase, session-by-session task breakdown using this stack
- **Detailed Prompt** — role/problem/solution/action/limitations prompt for driving Claude Code sessions
