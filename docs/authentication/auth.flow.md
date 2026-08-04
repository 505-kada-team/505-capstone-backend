# Authentication Flow Coffee Shop Inventory System

**Scope:** single-branch coffee shop backend. Two roles: `admin`, `cashier`.
**Stack:** Node.js / Express, MongoDB (Mongoose), JWT access tokens, opaque
rotated refresh tokens, OTP-based email verification & password reset.

This document describes the _current, implemented_ behavior of the auth
module. It is meant to be read alongside `auth.service.js`,
`auth.controller.js`, `auth.routes.js`, `user.model.js`, `refreshToken.model.js`.

---

## 1. Core Concepts

### 1.1 Access Token

- JWT, short-lived (`jwtConfig.accessExpires`).
- Payload: `{ sub: userId, role, tokenVersion }`.
- Signed with `jwtConfig.accessSecret`.
- **Stateless but revocable**: every request re-checks `decoded.tokenVersion`
  against `user.tokenVersion` in the DB (see `authenticate` middleware). If
  they don't match, the token is treated as dead even though its JWT `exp`
  hasn't passed yet. This is what allows "kill this session immediately"
  semantics (logout, password change, single-session eviction) without a
  token blocklist.

### 1.2 Refresh Token

- **Not a JWT.** A random 64-byte hex string (`crypto.randomBytes(64)`).
- Only `sha256(token)` is persisted in `RefreshToken.tokenHash` — the raw
  value is never stored, mirroring how passwords are hashed.
- **Single-use / rotated**: every successful `/refresh` call issues a brand
  new refresh token and marks the old one `usedAt`. The old one can never be
  used again, even if not expired.
- **Family-based reuse detection**: tokens produced by rotating one another
  share a `familyId`. If a token that is already `usedAt` or `revokedAt` is
  presented again, the _entire family_ is revoked and the caller is forced
  to log in again. This is the standard mitigation for "refresh token was
  stolen and both the attacker and the legitimate client are now racing to
  use it."
- TTL differs by platform: 7 days (web), 30 days (mobile).
- A MongoDB TTL index (`expiresAt`, `expireAfterSeconds: 0`) garbage-collects
  expired documents automatically.

### 1.3 Where tokens live

| Platform | Access token                           | Refresh token                                          |
| -------- | -------------------------------------- | ------------------------------------------------------ |
| web      | JSON body (kept in memory client-side) | `httpOnly` cookie (`secure: true`, `sameSite: 'none'`) |
| mobile   | JSON body                              | JSON body (client stores in Keychain/Keystore)         |

`sameSite: 'none'` is required because frontend and backend are on different
domains. See RFC-0001 for the CSRF implication this creates and what to
verify.

### 1.4 Roles

`User.role` ∈ `{ admin, cashier }`, default `cashier`. Enforcement point is
`authorize(...roles)` in `auth.middleware.js`. It is defined and ready but
not yet attached to any route in the flows below — that's expected, since
inventory endpoints (the actual admin/cashier-differentiated resources)
haven't been built yet. When they are, wire it as:

```js
router.post('/products', authenticate, authorize('admin'), createProduct);
```

---

## 2. Registration → Email Verification

```
POST /auth/register        {name, email, password}
  → creates User (isEmailVerified: false)
  → sends OTP to email
  → 201, returns user object only (NO tokens)

POST /auth/verify-email/send      {email}     (resend, cooldown-limited)
POST /auth/verify-email/confirm   {email, code}
  → on success: isEmailVerified = true
```

Notes:

- No tokens are issued at registration on purpose — an unverified user must
  not be treated as "logged in."
- `emailVerificationSentAt` + `otpConfig.resendCooldownSeconds` prevent
  spamming the resend endpoint.
- `emailVerificationAttempts` + `otpConfig.maxAttempts` prevent brute-forcing
  the OTP.
- `otpLimiter` middleware adds a second, IP+email-keyed rate limit on top of
  the app-wide limiter.
- ⚠️ **Known gap** (see error-handling audit): both send/confirm reveal
  whether an email is registered via a `404 Email not found`. Flagged for
  fix.

## 3. Login

```
POST /auth/login   {email, password}
  1. find user, compare password (bcrypt) → generic 401 on any mismatch
  2. reject if !isEmailVerified → 403 EMAIL_NOT_VERIFIED
  3. enforceSingleSession(user)        (see §7)
  4. issue access token (tokenVersion baked in)
  5. issue + persist refresh token
  6. web: set cookie, return {user, accessToken}
     mobile: return {user, accessToken, refreshToken}
```

The 401 message is intentionally identical whether the email doesn't exist
or the password is wrong ("Email or password is incorrect") — this is
correct, standard practice (prevents user enumeration via the login form).

## 4. Authenticated Requests

```
Authorization: Bearer <accessToken>
  → jwt.verify (catches expired/invalid → 401)
  → load user, compare tokenVersion → 401 if mismatched (session was killed)
  → compare passwordChangedAt vs token iat → 401 if token predates a
    password change (covers the edge case where a token was minted, then
    password changed, all within the same tokenVersion window)
  → req.user set, next()
```

## 5. Refresh (Rotation)

```
POST /auth/refresh   (cookie or body.refreshToken)
  1. hash presented token, look it up
  2. not found            → 401 "Refresh token not recognized"
  3. usedAt or revokedAt  → revoke whole family, 401 "Invalid session"
  4. expired              → 401 "Refresh token is invalid or expired"
  5. atomic claim: findOneAndUpdate({..., usedAt: null}, {usedAt: now})
     → if this loses a race (someone else claimed it first), treat as reuse
       and revoke the family too
  6. bump user.tokenVersion (old access tokens die immediately)
  7. issue new access token + new refresh token (same familyId, parentId =
     old token's _id)
```

Step 5's atomic `findOneAndUpdate` closes the TOCTOU gap between the
`findOne` read and the "mark used" write — two concurrent refresh calls with
the same token can't both succeed.

## 6. Logout

```
POST /auth/logout   (cookie or body.refreshToken)
  → revoke that one refresh token (if found)
  → bump tokenVersion (kills the currently-held access token too)
  → clear cookie
```

`logoutAllDevices` (service function exists, route currently commented out)
revokes every refresh token for the user and bumps `tokenVersion` — intended
as an **admin action against another user's account**, not self-logout.

## 7. Single-Session Enforcement

Controlled by `singleSessionOnly` config flag. Runs inside `login()`,
_before_ the new access token is generated (order matters — see the comment
in the source):

```
if no other active (non-revoked, non-used) refresh token exists → no-op
else:
  revoke all of this user's existing refresh tokens
  tokenVersion += 1   (kills existing access tokens instantly, not at exp)
```

Net effect: logging in on a new device silently ends every other session.

## 8. Forgot Password (3-step / "Pattern B")

```
POST /auth/forgot-password              {email}
  → ALWAYS 200, regardless of whether email exists (no enumeration)
  → if user exists: generate OTP, email it (cooldown-limited, silent)

POST /auth/forgot-password/verify-code  {email, code}
  → validates OTP (attempts/expiry-limited)
  → on success: issues a short-lived, single-purpose resetToken (JWT,
    separate secret, payload includes a one-time `nonce` also stored on
    the user)

POST /auth/reset-password               {resetToken, newPassword}
  → verifyResetToken middleware: verifies JWT, purpose === 'reset-password',
    and that the nonce still matches what's on the user (i.e. not already
    consumed)
  → sets new password, clears nonce, tokenVersion += 1, revokes all refresh
    tokens → forces re-login everywhere
```

The nonce is what makes the resetToken single-use: once consumed, the
stored nonce is cleared, so replaying the same JWT fails even though the
JWT itself hasn't expired.

## 9. Change Password (authenticated)

```
PATCH /auth/change-password   {oldPassword, newPassword}
  → requires authenticate
  → verify oldPassword
  → reject if newPassword === oldPassword
  → tokenVersion += 1, revoke all refresh tokens
    → current device gets a fresh accessToken from the response context
      only implicitly; in practice the client should treat this like a
      forced logout-elsewhere and re-issue its own session if needed
```

---

## 10. State Diagram (per user)

```
                register
                   │
                   ▼
        ┌─ isEmailVerified:false ─┐
        │                          │ verify-email/confirm
        │  verify-email/send(OTP)  │
        └──────────────────────────┘
                   │
                   ▼
        ┌─ isEmailVerified:true ──┐
        │                          │
        │        login             │  wrong pwd → generic 401
        └──────────────────────────┘
                   │
                   ▼
         ┌─ active session ────────────────────────────┐
         │  access token (tokenVersion=N)                │
         │  refresh token family F, generation 0          │
         └────────────────────────────────────────────────┘
              │ refresh              │ logout / change-pwd /  │ login on
              ▼                      │ reset-pwd               │ new device
    tokenVersion=N+1                 ▼                         ▼
    refresh family F gen 1    all sessions killed      other sessions killed
```
