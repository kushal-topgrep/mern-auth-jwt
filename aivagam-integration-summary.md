# Aivagam ↔ quant0 — what we actually did

> **Read this first, then the detail.** `aivagam-integration.md` (same folder) is
> the 3 900-line playbook with every code block; `aivagam-integration-checklist.md`
> is the do-this-then-that list. **This file is the after-the-fact record**: what
> the integration ended up looking like, what was added, what was ripped out, and
> why — enough that someone joining cold can hold the whole thing in their head.
>
> Written 2026-08-03, against branch `q0-integration` in all three Aivagam repos.

---

## 1. The one-sentence shape

**Aivagam stopped owning login.** All three Aivagam pieces now hand the browser to
quant0's hosted Login Portal, get an OAuth access token back, and exchange it for
an Aivagam session. Aivagam still owns *everything else* — accounts, roles,
permissions, courses, billing. quant0 answers exactly one question: **"who is
this person?"**

Everything below is a consequence of that one split.

---

## 2. The three repos, and what each one is

Aivagam is not one codebase. It is three, and they were each touched differently.

| Repo | What it is | Runs on | Role after integration |
|---|---|---|---|
| **`server/`** | Node.js + Express + Knex API — **the main backend** | `:8080` | Verifies quant0 tokens, owns the `user` table, creates/links users, serves the migration webhook |
| **`client-react-web/`** | React SPA (CRA + react-app-rewired) — **the main learner app** | `:3000` | Redirects to the portal, holds the token, calls `server/` |
| **`mission-control/`** | Node/Express backend **+** its own React SPA in `client/` — staff/admin console | `:5001` (API), `:5002` (SPA) | Same shape as the other two, but **never creates a user** and is gated on `mc.signin` |

`mission-control/` shares **one database** with `server/`. That is load-bearing —
see §4.

The quant0 side, for reference: gateway `:8082`, hosted Login Portal `:3010`,
hosted Account Portal `:3001`, org-portal (admin UI) where the application and the
migration connection were configured.

---

## 3. What was registered on the quant0 side

- **One organisation** for Aivagam.
- **One application, type `single_page`** — `client_id` **`app_08ca850c037c1ebe`**.
  - **Shared by both SPAs** (learner app *and* Mission Control). Not two apps.
    Reason: the `user` table links a quant0 identity through a single
    `quant0_sub` column, so a staff member who is also a learner cannot have two
    subjects under two applications. The staff/learner boundary is a
    **permission** (`mc.signin`), not an application split.
  - `redirect_uris` / `allowed_origins` list **three** origins — the learner SPA's
    `/callback`, Mission Control's `/callback`, and the **hosted Account Portal's
    `/callback`** (the third is the easy one to forget; without it the "Manage
    account" link dead-ends).
- **Two agent identities** (`q0-agent`) — one sidecar per backend, so token
  verification is offline.
- **One migration connection** (org-level, under *User migration* in org-portal),
  pointing at the Aivagam server's fetch-hash webhook, and attached to the
  application. See §7.

No SPA installs a quant0 client SDK. The browser side is plain
`fetch` + Web Crypto + Web Storage — ~370 lines in `src/app/quant0.js`, copied
near-verbatim into both SPAs.

---

## 4. How authentication actually works now

**Login (both SPAs, identical):**

1. User hits a protected route → SPA sees no quant0 session → **full-page
   redirect** to `GET :8082/v1/oauth/authorize` with **Authorization Code + PKCE**
   (`code_challenge` S256, `state`, `redirect_uri=<origin>/callback`,
   `scope=openid profile email offline_access`).
2. quant0's hosted portal does *all* of it — password, magic link, Google,
   Facebook, SAML, MFA, forgot-password, sign-up. Aivagam renders none of it and
   needs no code change to add a provider.
3. Portal redirects back to **`/callback`** with a code. The SPA exchanges it at
   `POST :8082/v1/oauth/token` and stores `access_token` / `refresh_token` /
   `expires_at` in Web Storage.
4. SPA calls **`POST /api/auth/quant0/session`** on its own backend with the
   bearer.
5. Backend verifies the token **offline via its local q0-agent** (signature +
   expiry against a cached JWKS — no network call to quant0 on the request path),
   then resolves the person:
   - `user.quant0_sub = claims.subject` → found → done.
   - Not found → `GET /v1/me` for the email → match an existing Aivagam user by
     email → **link** (write `quant0_sub`).
   - Still nothing → **create** (learner app only, always a personal `scholar`
     account). Mission Control **refuses** — 403.
6. Backend picks the tenant (`X-Account-Id` if the user is a member, else
   `default_account`), loads permissions from `account_users.role_id` exactly as
   before, and returns the normal Aivagam bootstrap payload — **minus the Aivagam
   JWT**.

**Every request after that:** an axios interceptor attaches
`Authorization: Bearer <quant0 access token>` and silently refreshes it 60 s
before expiry. `model/auth.js`'s `auth.verify()` sees the bearer, checks
`iss` against `QUANT0_ISSUER_PREFIX` (decode only, never verify at that point),
and takes the quant0 branch; anything else falls through to the untouched legacy
HS256 path.

**The key design point:** the quant0 token carries **identity only**. Permissions
are still resolved account-scoped from `account_users(role_id)` through Aivagam's
existing `loadPermissions()`. That is why multi-account roles and account
switching kept working with zero changes.

**Sign-out** ends the quant0 session (`/v1/oauth/logout`) and clears local
storage. There is no Aivagam token row to delete — a quant0 session is stateless
on the Aivagam side.

---

## 5. What was ADDED

### `server/` (main backend)

- **`helper/quant0.js`** — `isQuant0Token()`, `verify()` (via agent),
  `verifyDetail()` (human-readable failure reason, because `verify()` collapses
  expired / bad-signature / unknown-key into one indistinguishable 401),
  `fetchMe()`, `resolveUserBySub()`.
- **`model/auth.js`** — `verifyQuant0Bearer()` plus a 5-line guard at the top of
  the Bearer branch. Legacy path byte-for-byte untouched.
- **`controller/authController.js`** — `quant0Session()` (the bootstrap) and
  `provisionNewScholarAccount()` (the *only* place a new person is created, and it
  can only ever produce a `scholar`).
- **`controller/inviteController.js`** — `accept()`, so an invitee lands in the
  inviting org's account with the invited role instead of a personal account.
- **Two routes with deliberately NO `auth.verify()`** —
  `POST /api/auth/quant0/session` and `POST /api/auth/quant0/migration/get-user`.
  The middleware demands the link that the first of these *creates*; gating it
  would be a catch-22 that makes first login impossible.
- **Migration** — `user.quant0_sub` column. Run **once**, from `server/`; Mission
  Control shares the database and must not run it again.
- `scripts/quant0-provision-rbac.js` — optional, mirrors Aivagam's role/permission
  catalog into quant0.

### `client-react-web/` (main SPA)

- **`src/app/quant0.js`** (367 lines) — the whole OAuth client: PKCE
  challenge/verifier, authorize redirect, code exchange, refresh-with-skew, token
  storage, `installQuant0AxiosInterceptor()`, `openQuant0AccountPortal()`.
- **`src/views/auth/callback.js`** + the **`/callback`** route — **one route
  handles password, magic link, Google, Facebook, SAML and MFA.** Guarded with a
  `useRef`, not state: authorization codes are single-use and React 18 StrictMode
  double-invokes effects in dev.
- **`src/views/auth/portalRedirect.js`** — shared body for every auth view quant0
  now owns.
- **`src/views/account/security.js`** — the one place that opens the hosted
  Account Portal (ticket bounce, no second login).
- `src/app/auth.js` — `completeQuant0Login()`, rewritten `signout()` /
  `switchAccount()`, and a **`PrivateRoute` fix**: it gated on `user?.token`,
  which a quant0 session never has.

### `mission-control/` (backend + its own SPA)

- Same four backend files (`helper/quant0.js`, quant0 branch in `model/auth.js`,
  `controller/authController.js` bootstrap, `api/auth.js` route).
- Same `src/app/quant0.js` + `/callback` + `PrivateRoute` fix in `client/`.
- The SDK tarball **vendored** (`vendor/quant0-sdk-core-*.tgz`, with a
  `!vendor/*.tgz` gitignore negation) and copied in the Dockerfile before
  `npm install` — a `file:` dependency without its tarball is ENOENT for the
  *entire* dependency tree, not just that package.

### On the quant0 side (one change, for Aivagam's sake)

`@quant0/sdk-core` was ESM-only; Aivagam's backends are CommonJS. A `dist/cjs`
build + `require` conditions were added so `require()` and `import` both work.

---

## 6. What was REMOVED

This is the visible half of the change. In `client-react-web` the integration
commit was **+806 / −2 999 lines** — almost all of it deletion.

Every one of these **kept its route registered** and now just redirects to the
hosted portal. Old emails, bookmarks and muscle memory point at these URLs, so
deleting the routes would turn a stale link into a 404.

| View | Before | After | What went away |
|---|---:|---:|---|
| `views/auth/signin/index.js` | 1005 | **60** | The whole email + password sign-in form, captcha, OTP wiring |
| `views/account/password.js` | 700 | **17** | Change-password form and its validation |
| `views/auth/signup/account.js` | 424 | **7** | Email sign-up form |
| `views/auth/signup/user.js` | 372 | **62** | Invite sign-up form (kept logic: stashes the invite id across the round-trip) |
| `views/auth/signup/verify.js` | 142 | **6** | Email-verification screen |
| `views/account/2fa.js` | 113 | **17** | TOTP enrolment/QR screen |
| `views/auth/signin/magic.js` | 99 | **7** | **Magic-link request + consume UI** |
| `views/auth/signin/social.js` | 70 | **6** | Google/Facebook buttons |
| `views/auth/signin/resetpassword.js` | 57 | **6** | Reset-password form |
| `views/auth/signin/forgotpassword.js` | 37 | **6** | Forgot-password form |

So, plainly: **email sign-up, email/password sign-in, magic link, social buttons,
forgot/reset password, email verification and 2FA enrolment are all gone from the
Aivagam frontend.** What is left on those routes is a redirect and a loading
spinner. quant0's portal renders all of it, and offers factors Aivagam never had
(WebAuthn, recovery codes).

Also removed: the **static `Authorization` default header** on axios in
`src/app/app.js`. A static header cannot silently refresh a short-lived token, so
it was replaced by `installQuant0AxiosInterceptor()`. In Mission Control the
interceptor additionally names the Aivagam server's origin explicitly
(`extraOrigins`) — MC calls **two** backends, and the old static header went out
to both regardless of host, so a naive baseURL-only interceptor silently 401s
every cross-origin MC view.

**Not removed, on purpose:** the legacy sign-in path on both backends. Both accept
legacy Aivagam JWTs *and* quant0 tokens throughout, which is what made every
frontend cutover reversible. The legacy controllers, `speakeasy`, and the OTP
routes are scheduled for deletion at rollout Stage 5, not now.

---

## 7. User migration — existing Aivagam users keep their passwords

The problem: Aivagam already has users with bcrypt passwords in its own `user`
table. quant0 has never seen them. Without help, every existing user would hit a
password reset on day one.

The fix is **JIT (lazy) migration**, and it is invisible to the user:

1. Existing user types their old Aivagam password into quant0's portal.
2. quant0 has no row for that email → it calls Aivagam's
   **`POST /api/auth/quant0/migration/get-user`** with just the email.
3. Aivagam returns the stored **bcrypt hash** (`$2b$10$…`) and the profile.
4. quant0 verifies the password **locally** against that digest, then re-hashes to
   argon2id and stores it. The user is now migrated (`migration_source: jit`).

**The plaintext password never leaves quant0's process** — that is the whole point
of the fetch-hash contract.

Security properties that are deliberate, not incidental:

- **HMAC-SHA256 is the only gate** — `sha256=` + hex HMAC over
  `"<timestamp>" + "." + <raw body bytes>`, compared constant-time. The timestamp
  is inside the signed material to stop replay.
- The route mounts **`express.raw()` before the global `express.json()`** in
  `server.js`. The HMAC is over the exact received bytes; parsing and
  re-serialising would not reproduce them.
- **Absence is `200 {"found":false}`, never `404`** — a 404 would make the endpoint
  a user-enumeration oracle. `401` is reserved strictly for a bad signature. A
  known but social-only (passwordless) user is also `found:false`.
- The lookup reads the `user` table **directly**, not via `user.get()`, whose inner
  join on `account_users` hides a user with no membership row — such a user must
  still be able to log in.
- **This endpoint hands out password hashes, so it is transitional.** Once the
  Migration tab reports zero pending legacy users and purge-legacy has run, delete
  the route and the secret.

Full contract and a reference implementation: `docs/architecture/user-migration-plan.md`
§16, and `server/docs/quant0-migration-getuser-endpoint-plan.md` on the Aivagam side.

---

## 8. Mission Control — the four things it does differently

Worth calling out, because copying the learner-app wiring literally breaks each of
these:

1. **It never creates a user.** MC has no self-signup; staff are provisioned by
   other admins. It will *link* an already-provisioned staff member to a quant0
   subject by verified email, but an unknown person is denied however valid their
   token is.
2. **Login is gated on the `mc.signin` permission**, checked in both the bootstrap
   and `auth.verify()`. Since MC shares the application with the learner app,
   quant0 will happily authenticate any scholar in the org — `mc.signin` is the
   actual security boundary. The bootstrap reads that gate straight from
   `roles_permissions`, not from the Redis-backed `loadPermissions`: the one call
   that decides whether a session exists at all must not succeed off a stale cache.
3. **`/` *and* `/signin` both render the sign-in view.** A bare redirect-on-mount
   would turn every visit to the MC root into a full authorize round-trip, on the
   most-visited URL in the app. It checks for a live session first.
4. **Two backends** (MC's own on `:5001`, Aivagam's on `:8080` via absolute URLs) —
   hence `extraOrigins` on the interceptor, see §6.

A non-staff user who completes portal login gets a bare 403. `/callback` turns
that specific status into a message that says so, rather than a generic failure
they would read as "wrong password".

---

## 9. Environment variables (the whole set)

**Backends** — `server/.env` and `mission-control/.env`:

```
QUANT0_AGENT_URL=http://127.0.0.1:9595     # local q0-agent sidecar
QUANT0_API_BASE=http://localhost:8082/v1   # gateway + /v1
QUANT0_ISSUER_PREFIX=http://localhost:8082 # how a quant0 token is recognised
QUANT0_APPLICATION_ID=app_08ca850c037c1ebe
QUANT0_MIGRATION_SECRET=<shared HMAC secret>   # server/ only
```

**SPAs** — `client-react-web/.env` and `mission-control/client/.env`:

```
REACT_APP_QUANT0_DOMAIN=http://localhost:8082          # the GATEWAY, not the portal
REACT_APP_QUANT0_CLIENT_ID=app_08ca850c037c1ebe
REACT_APP_QUANT0_ACCOUNT_PORTAL_URL=http://localhost:3001
```

`REACT_APP_QUANT0_DOMAIN` is the **gateway** (`:8082`), not the Login Portal
(`:3010`) and not the Account Portal (`:3001`). Getting this wrong is the single
most common bring-up failure.

Secrets stay out of git — `.env` files are not committed.

---

## 10. What deliberately did NOT change

- **Accounts, roles, permissions and the permission catalog.** quant0 supplies
  identity; Aivagam still owns authorisation, account-scoped, from
  `account_users.role_id`.
- **Multi-account membership and account switching.**
- **Every business route and view** — courses, labs, internships, billing,
  pricing, MC's other 66 routes.
- **`config-overrides.js`** in either SPA. No build config change was needed,
  because no client SDK was installed.
- **The legacy auth path on both backends.** Still live, still accepting Aivagam
  JWTs, until Stage 5 of the rollout.
- **Aivagam's database schema**, apart from the single `user.quant0_sub` column.

---

## 11. Where the code is

Branch **`q0-integration`** in all three repos.

| Repo | Commit | What |
|---|---|---|
| `server/` | `9cbeeb99` | quant0 hosted auth for session bootstrap |
| `server/` | `67438e64` | quant0 env vars |
| `server/` | `3bc145c4` | migration `get-user` fetch-hash webhook |
| `client-react-web/` | `8006100e` | integrate quant0 as auth service (+806 / −2 999) |
| `client-react-web/` | `a8f6d6d0` | attach the bearer on the first session call |
| `mission-control/` | `90434eb` | accept quant0 sessions (backend) |
| `mission-control/` | `9f28bfd` | redirect MC sign-in to the portal (SPA) |
| `mission-control/` | `268bd56` | `role_id` on account assignment |

Further reading, in order of depth:

- `aivagam-integration-checklist.md` — the do-this list.
- `aivagam-integration.md` — the full playbook; **§9 is the troubleshooting table**
  covering every failure hit during bring-up (60-second sessions, the first-login
  401 catch-22, instant logout loop, CORS, `crypto.subtle` undefined, StrictMode
  double-exchange).
- `../architecture/user-migration-plan.md` §16 — the fetch-hash webhook contract.
- `../testing/flows.md` §93 — migration test flows.
