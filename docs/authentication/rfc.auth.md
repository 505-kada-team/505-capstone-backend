# RFC-0001: Authentication & Session Architecture

- **Status:** Accepted (in production for the auth module; inventory module
  builds on top of it later)
- **Context:** single-branch coffee shop POS/inventory system. Two roles
  (`admin`, `cashier`). Frontend and backend deployed on different domains
  (backend on Render). Web client + potential future mobile client.

---

## 1. Password hashing: bcrypt

**Decision:** `bcryptjs`, cost factor 10, via a Mongoose `pre('save')` hook.

**Alternatives considered:**

- _argon2_ — winner of the Password Hashing Competition, generally the
  modern recommendation (better resistance to GPU/ASIC cracking at
  equivalent settings).
- _scrypt_ — memory-hard, built into Node's `crypto`, no extra dependency.

**Why bcrypt anyway:** for a single-branch shop with a small, known set of
accounts (a handful of admins/cashiers, not a public user base), the
marginal security gain from argon2's memory-hardness is low relative to the
operational simplicity of bcrypt (`bcryptjs` is pure-JS, no native build
step — relevant on constrained hosts like Render's free/small tiers, where
`argon2`'s native bindings occasionally cause build friction). bcrypt at
cost 10 is still well above brute-force-feasible for this threat model.

**Consequence / open item:** if the user base grows or this becomes
multi-tenant, revisit — argon2id would be the recommendation at that point.

---

## 2. Access token: short-lived JWT, not opaque

**Decision:** JWT, ~15 min expiry, payload `{sub, role, tokenVersion}`.

**Alternatives considered:**

- Opaque access token validated against a session store on every request
  (like the refresh token design below).

**Why JWT for the access token specifically:** the access token is checked
on _every_ protected request, so avoiding a DB round-trip per request
matters for latency/DB load. A signature check is enough for 99% of
requests. The `tokenVersion` field is the escape hatch for the 1% case
(explicit revocation) — it costs one indexed `findById` per request, which
is already necessary anyway to load `req.user`, so it's not an _additional_
query, just an additional field to select.

**Why not opaque for access tokens too:** would mean a DB hit on literally
every API call for zero extra benefit at this scale, since `tokenVersion`
already gives near-instant revocation.

---

## 3. Refresh token: opaque + hashed-at-rest + rotation + family reuse detection

**Decision:** random 64-byte string, only its SHA-256 hash stored, single-use,
rotated on every `/refresh`, reuse of a dead token revokes the whole
lineage (`familyId`).

**Alternatives considered:**

- JWT refresh token (stateless, like the access token).
- Long-lived JWT refresh token with no rotation.

**Why not a JWT refresh token:** a stateless refresh token can't be
made single-use or detect reuse without _becoming_ stateful (you'd need a
server-side record of which JWTs have been consumed anyway — at which point
you've built the opaque-token system but with extra JWT overhead on top).
Since refresh tokens are the long-lived credential an attacker most wants to
steal, reuse detection is the single highest-value security property here,
so the design starts from "needs server state" and picks the simplest
credential shape for that: a random string.

**Why hash it at rest:** identical reasoning to password hashing — if the
DB is ever exposed (backup leak, injection, insider access), stored refresh
tokens shouldn't be directly usable. SHA-256 (not bcrypt) is deliberate: the
token is already 128 hex characters of real entropy, so it doesn't need
bcrypt's slow, salted, brute-force-resistant properties the way a
human-chosen password does — a fast hash is fine and keeps `/refresh`
cheap.

**Why rotation + family revocation over "just make it long-lived":** without
rotation, a stolen refresh token is valid until its TTL (up to 30 days for
mobile) with no way to distinguish the attacker's usage from the legitimate
user's. Rotation means a stolen-and-used token immediately breaks the
legitimate user's next refresh attempt (their locally-stored token no
longer matches DB state), which becomes an observable signal — the family
gets revoked and both parties are forced to re-authenticate. This is the
standard pattern (used by e.g. Auth0, and described in the OAuth 2.0
Security BCP as "Refresh Token Rotation with automatic reuse detection").

**Consequence:** slightly more DB traffic per refresh (an update + an
insert instead of a signature check), acceptable at this scale.

---

## 4. Single-session enforcement via `tokenVersion` bump, not a session whitelist

**Decision:** logging in on a new device revokes all other refresh tokens
and bumps `tokenVersion`, killing outstanding access tokens without waiting
for their `exp`.

**Alternatives considered:**

- Allow multiple concurrent sessions (typical for consumer apps).
- Maintain an explicit "active sessions" list surfaced to the user
  ("log out this device" UI).

**Why single-session:** in a physical shop, one cashier or admin is
generally expected to be logged in on one register/device at a time; a
stray logged-in session on an old device (e.g., a shared tablet) is a real
operational risk (someone else using a former employee's still-valid
session) more than a convenience trade-off. This is a deliberate business
constraint, not a generic "best practice" — worth revisiting if the shop
later wants, e.g., an admin logged in on a laptop _and_ a phone
simultaneously.

---

## 5. OTP-over-email, not magic links

**Decision:** 4–8 digit numeric OTP, hashed at rest (SHA-256), short TTL,
attempt-limited, cooldown-limited, used for both email verification and
password reset.

**Alternatives considered:**

- Magic link (single click, no code to type).
- TOTP app (Google Authenticator-style) instead of email.

**Why OTP-over-email:** cashier/admin accounts are provisioned by the shop
owner, not self-service consumers — a short numeric code that can be typed
on a POS terminal (which may not have easy access to click an email link,
e.g. checking email on a phone while using the register on a tablet) is
more practical than a magic link tied to a specific browser/device context.
It's also simpler to reason about security-wise: expiry + attempt cap +
resend cooldown covers the relevant threat model (brute force, replay)
without needing link-specific concerns (email client link prefetching by
security scanners accidentally consuming the token, etc. — a real,
recurring issue with magic links).

---

## 6. Cookie strategy: `httpOnly`, `secure: true`, `sameSite: 'none'`

**Decision:** refresh token for web clients lives in an `httpOnly` cookie
with `sameSite: 'none'; secure: true`, required because frontend and
backend are on different domains.

**Trade-off this introduces — flagged for verification, not yet resolved
in the reviewed code:** `sameSite: 'none'` means the cookie is sent on
cross-site requests too, which is exactly what CSRF protection normally
relies on `sameSite: 'strict'/'lax'` to prevent. Cross-domain deployments
lose that free protection. This is commonly mitigated by:

1. Strict CORS (`Access-Control-Allow-Origin` pinned to the exact frontend
   origin, credentials mode on) — the code shown doesn't include the CORS
   config, so this should be confirmed.
2. A CSRF token (double-submit cookie or header-based) on state-changing
   requests (`/refresh`, `/logout`, `/change-password`, etc.).

**Recommendation:** confirm (1) is in place; if not, or as defense in
depth, add (2). This is called out explicitly in the error-handling audit
as a follow-up, not fixed in this pass since it touches CORS config not
included in the reviewed files.

---

## 7. Role model: flat enum (`admin` / `cashier`), not a permissions table

**Decision:** `User.role ∈ {admin, cashier}`, checked via
`authorize(...roles)` middleware.

**Alternatives considered:** granular permission system (roles map to sets
of permissions, permissions checked individually).

**Why flat enum:** two roles, one branch, no indication of needing
per-permission granularity (e.g. "cashier can void a sale but not edit
inventory cost"). A permissions table is the right call when the business
requirements demand it — introducing it now would be speculative
complexity. `authorize()` already takes a variadic role list
(`authorize('admin', 'cashier')`), so adding a third role later is cheap;
moving to granular permissions later is a bigger but isolated migration
(only `authorize` and the route wiring change, not the token shape, since
`role` is already a discrete claim in the JWT).

---

## 8. Summary Table

| Concern              | Choice                                          | Primary reason                                           |
| -------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| Password hash        | bcrypt (cost 10)                                | simplicity, no native build, sufficient for threat model |
| Access token         | JWT, 15 min, tokenVersion-checked               | no DB hit per request, revocable anyway                  |
| Refresh token        | opaque, hashed, rotated, family reuse detection | highest-value credential, reuse must be detectable       |
| Sessions             | single-session, tokenVersion bump               | physical-shop device-sharing risk                        |
| Verification / reset | OTP over email                                  | POS-terminal-friendly, self-contained security model     |
| Web token transport  | httpOnly cookie, sameSite=none                  | cross-domain deployment requirement                      |
| Roles                | flat enum + middleware                          | matches current business requirements, cheap to extend   |
