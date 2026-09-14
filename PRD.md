# Product Requirements Document (PRD)
## Project: NetGuard — Automated Network Password Rotation & Access Assistant

**Version:** 1.0
**Status:** Draft for implementation planning
**Owner:** [Fill in]
**Last updated:** 2026-09-14

---

## 1. Purpose (Why)

Shared, static network passwords are a recurring security failure mode: once a credential is known, it spreads informally (word of mouth, group chats, sticky notes) to people who were never authorized to use it. In this project's context, that has caused:

- **Network instability** from an uncontrolled number of connected devices.
- **Security exposure** from unauthorized or unvetted devices on a trusted network.
- **No accountability** — once a password is shared, there is no way to know who actually has it.

The fix is not just "rotate passwords more often" — rotation alone just shortens the leak window. The real fix is to pair rotation with a **gated distribution channel**: a system where the *new* password is never posted or manually shared, but is instead retrieved on-demand by individually authenticated people through an assistant that logs who asked for it. This turns an unmanaged secret into an auditable, access-controlled one.

## 2. Problem Statement

> Network security is bypassed when authorized users share the Wi-Fi password with unauthorized people. This causes overcrowding, instability, and unmanaged security risk on the building's network, because there is no mechanism to control *who* has the current password or to invalidate access without disrupting everyone.

## 3. Goals & Objectives

| Goal | Description | Success looks like |
|---|---|---|
| G1 | Automate password rotation | Password changes on a configurable schedule with zero manual admin action |
| G2 | Gate password distribution | Only authenticated, authorized individuals can retrieve the current password |
| G3 | Reduce unmanaged sharing | Fewer unknown/unauthorized devices connecting over time |
| G4 | Provide self-service support | Users get answers to common security questions without contacting IT |
| G5 | Give visibility to admins | Admins can see rotation history, who requested the password, and flag anomalies |

## 4. Non-Goals (explicitly out of scope for v1)

- Replacing enterprise-grade solutions like 802.1X / RADIUS with per-user credentials (this system manages a **shared** password's lifecycle, it does not eliminate the shared-password model itself — see Open Questions).
- Physical network hardware management (VLANs, firmware, port config) beyond triggering a password change via router/AP API.
- Building a full IT ticketing or helpdesk system — the chatbot handles a bounded set of security Q&A, not general IT support.
- Guest network management (unless explicitly requested later).

## 5. Users & Personas

- **Building Admin / IT Owner** — configures rotation frequency, views logs, manages the authorized-user list, can force an immediate rotation.
- **Authorized Occupant/Employee** — a person legitimately allowed on the network; opens the app, authenticates, asks the chatbot for the current password or a security question.
- **Unauthorized Person (threat actor in this scenario)** — someone who previously had a shared password informally; under this system, they lose access at the next rotation and have no path to re-obtain it without being added to the authorized list.

## 6. Key Features (Functional Requirements)

### 6.1 Password Rotation Engine
- Generates a new strong network password on a schedule.
- Schedule is configurable (e.g., every N hours/days/weeks) via the admin app.
- Pushes the new password to the network hardware (router/AP) via API/integration.
- Supports a manual "rotate now" override for admins (e.g., after a suspected leak).
- Keeps a rotation history (timestamp, triggered-by, success/failure) for audit purposes.
- Handles rotation failure gracefully (retry logic, admin alert, does not silently fail).

### 6.2 Admin Settings App
- Configure rotation frequency and rotation time window (e.g., avoid rotating during business hours).
- View rotation history and current password status (not necessarily the password itself, depending on the security model chosen — see §8).
- Manage the list of authorized users who are allowed to request the password.
- View chatbot request logs: who asked for the password, when, and whether it was granted.
- Revoke a specific user's authorization without waiting for the next rotation cycle.
- Receive alerts on anomalies (e.g., unusually high number of password requests in a short window, which could indicate the password is still being shared informally).

### 6.3 Chatbot
- **Identity verification before any sensitive action.** The user must authenticate (see §8) before the bot will do anything beyond generic, non-sensitive Q&A.
- **Password retrieval**: authenticated users can ask for the current password; bot returns it and logs the request.
- **Security Q&A**: answers common questions (e.g., "why did the password change," "how do I connect," "who do I contact if I'm having issues").
- **Network suggestions**: gives basic guidance (e.g., recommend enabling auto-reconnect issues troubleshooting, flag if a user's device seems to be having repeated connection failures based on logs, general best-practice tips).
- Refuses password requests from unauthenticated or unauthorized users, with a clear explanation of how to become authorized (i.e., contact the admin), rather than silently failing.
- Rate-limits repeated requests from the same user to reduce the value of the bot as a redistribution tool.

### 6.4 Authentication & Authorization Layer
*(This is the piece that makes the rest of the system actually solve the stated problem, so it is called out as its own feature rather than folded into "chatbot.")*
- Every person using the app/chatbot must have their own identity — not a shared login.
- Authorized-user list is managed by the admin (add/remove individuals).
- Options to evaluate (decide in Open Questions / styles doc): SSO against an existing directory (e.g., company email/Google/Microsoft account), invite-code-per-person, or admin-provisioned individual accounts.
- All password disclosures are tied to a specific authenticated identity in the logs — this is what creates accountability where none existed before.

## 7. User Flows (high level)

**Flow A — Admin configures rotation**
Admin logs into app → sets rotation frequency/window → saves → engine schedules next rotation → admin sees confirmation and next rotation time.

**Flow B — Scheduled rotation**
Engine triggers at scheduled time → generates new password → pushes to network hardware → confirms success → logs event → (optionally) notifies authorized users that a new password is available.

**Flow C — User requests password**
User opens app → authenticates → opens chatbot → asks for password → bot verifies authorization → bot returns password → event logged with identity + timestamp.

**Flow D — Unauthorized attempt**
Person opens app without valid authorization → tries to reach chatbot or request password → denied with guidance to contact admin → attempt logged for admin visibility.

**Flow E — Suspected leak**
Admin notices anomaly (e.g., spike in device count or password requests) → triggers manual rotation → optionally reviews request logs to identify the source.

## 8. Security & Compliance Considerations

- **The chatbot must not become the new leak vector.** Authentication has to be per-person, not a shared secret guarding a shared secret.
- Password should be encrypted at rest and in transit; avoid storing plaintext in logs.
- Consider whether the admin app itself should ever display the raw password to admins, or only confirm rotation status — this affects the threat model and should be decided explicitly, not by default.
- Audit logs (who requested what, when) should be tamper-evident and retained for a defined period.
- Rate limiting and anomaly alerts to catch continued informal sharing even after this system is live (e.g., one "authorized" person requesting the password unusually often might be relaying it).
- Define an offboarding process: when someone should lose authorization (e.g., employee leaves), and confirm it takes effect immediately, not just at next rotation.

## 9. Success Metrics

- Reduction in number of unique/unrecognized devices connected to the network over time.
- Number of unauthorized password requests denied (should trend down as informal sharing stops).
- Rotation success rate (target: near 100% automated success without admin intervention).
- Chatbot resolution rate for security Q&A (fewer questions escalated to human IT).
- Time-to-revoke: how quickly a removed user actually loses access.

## 10. High-Level Technical Constraints & Assumptions

*(Full technology choices belong in the companion Styles document — this section only captures constraints that shape scope.)*

- Requires some form of programmatic access to the network hardware (router/access point) to push password changes — this must be confirmed/scoped before implementation begins, as it varies by hardware vendor.
- Requires a persistent store for: rotation history, authorized-user list, and chatbot request logs.
- Requires an authentication mechanism (see §6.4) — assumed to be decided before development starts, since it affects the data model.
- Assumes the app has both an admin-facing surface and an end-user-facing surface (could be one app with role-based views, or two separate apps — to be decided in styles/architecture doc).

## 11. Implementation Phases (Checkpoints for multi-session development)

Each phase below is designed to be a **self-contained, non-overlapping checkpoint** — a session can complete a phase and leave the project in a working, committable state without depending on unfinished work from a later phase.

- **Phase 0 — Foundations:** project scaffolding, tech stack setup, data models, environment/config, no functional features yet.
- **Phase 1 — Rotation Engine:** password generation, scheduling, hardware integration (or a mocked interface if hardware access isn't available yet), rotation history logging. Independently testable via CLI/API before any UI exists.
- **Phase 2 — Authentication & Authorization Layer:** identity system, authorized-user management, login flow. Independently testable before the chatbot or admin UI consumes it.
- **Phase 3 — Admin App:** settings UI for rotation frequency, rotation history view, authorized-user management UI, request logs, manual rotation trigger.
- **Phase 4 — Chatbot:** password retrieval (authenticated), security Q&A, network suggestions, rate limiting, denial flow for unauthorized users.
- **Phase 5 — Observability & Hardening:** anomaly detection/alerts, audit log integrity, offboarding flow, edge-case handling (rotation failure, hardware unreachable, etc.).
- **Phase 6 — Polish & Launch Readiness:** end-to-end testing across phases, documentation, deployment.

(The companion **Task List** document will break each phase into concrete, assignable tasks with explicit "done" criteria so a new Claude Code session can pick up exactly where the last one stopped.)

## 12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Chatbot becomes new sharing vector | Per-person auth + rate limiting + request logging (§6.4, §8) |
| Hardware API doesn't support programmatic password changes | Validate hardware capability in Phase 1 before building on top of it; fall back to a semi-automated flow (system prepares password, notifies admin to apply it) if needed |
| Rotation breaks connectivity for legitimate users mid-work | Configurable rotation windows (§6.1); advance notice to authorized users |
| Authorized list goes stale (ex-employees still listed) | Explicit offboarding process (§8) and periodic admin review reminders |
| Admin app itself becomes a single point of compromise | Strong admin auth (ideally separate/stronger than regular user auth), audit logging of admin actions |

## 13. Open Questions (to resolve before/during Phase 0–2)

1. What authentication method for end users — SSO, per-person invite codes, or admin-provisioned accounts?
2. What network hardware/vendor is in use, and does it expose an API for password changes?
3. Should the raw password ever be visible to admins in the UI, or only to the chatbot flow with full logging?
4. Is there an existing employee/occupant directory to integrate with for authorization, or does this need to be built from scratch?
5. Single app with role-based views (admin vs. user) or two separate apps?
6. Notification channel for "new password available" or admin alerts — email, push, SMS, in-app only?

---

**Next documents in this project set:**
- **Styles document** — technology stack and architectural decisions
- **Task List** — phase-by-phase, session-by-session task breakdown
- **Detailed Prompt** — role/problem/solution/action/limitations prompt for driving Claude Code sessions
