# Error Handling Audit — Auth Module

Goal: bring error handling to a consistent, industry-standard shape across
every auth endpoint. Findings are ordered by severity. Each includes: current
behavior, why it matters, and a concrete fix.

> Note: `ApiError`, `ApiResponse`, `asyncHandler`, and the global error
> handler weren't included in the files reviewed, so exact patches to those
> files aren't included here — but the shape they need to support is
> specified below. Share those files and I can wire the fixes directly into
> your repo.

---

## Finding 1 (High) — Email enumeration via verification endpoints

**Where:** `sendVerificationCode`, `confirmVerificationCode` in
`auth.service.js`.

**Current:**

```js
const user = await User.findOne({ email })...
if (!user) {
  throw new ApiError(404, 'Email not found');
}
```

This lets anyone probe `/auth/verify-email/send` with a list of emails and
learn which ones are registered — inconsistent with `forgotPassword`, which
correctly stays silent for unknown emails.

**Why it's inconsistent, not just "less safe":** you already solved this
exact problem correctly one flow over. There's no reason `verify-email`
should have a weaker posture than `forgot-password`.

**Fix — mirror the `forgotPassword` pattern:**

```js
const sendVerificationCode = async (email) => {
  const user = await User.findOne({ email }).select('+emailVerificationSentAt +isEmailVerified');

  // Silently no-op for unknown emails or already-verified accounts —
  // don't leak account existence/state through this endpoint.
  if (!user || user.isEmailVerified) return;

  if (user.emailVerificationSentAt) {
    const secondsSinceLastSend = (Date.now() - user.emailVerificationSentAt.getTime()) / 1000;
    if (secondsSinceLastSend < otpConfig.resendCooldownSeconds) return;
  }

  const code = generateOtp();
  user.emailVerificationCode = hashOtp(code);
  user.emailVerificationExpires = getOtpExpiry();
  user.emailVerificationSentAt = new Date();
  user.emailVerificationAttempts = 0;
  await user.save();

  await sendOtpEmail({ to: user.email, code, purpose: 'verify-email' });
};
```

Controller response becomes generic regardless of outcome: `200, "If the
email is registered and unverified, a code has been sent"`.

`confirmVerificationCode` is lower-risk (right after registration the user
already knows their own email is registered) but for consistency, consider
collapsing "user not found" and "invalid code" into the same generic 400
`Invalid or expired code` rather than a distinct 404.

---

## Finding 2 (Medium) — No machine-readable error codes

**Current:** only one error (`EMAIL_NOT_VERIFIED`) carries a `code`;
everything else is a bare message string. A frontend/mobile client that
needs to branch on error type (e.g., "show a resend-code button" vs "show a
generic toast") has to string-match `err.message`, which breaks the moment
copy changes or gets translated.

**Fix:** give every distinct error a stable `code`, e.g.:

| Code                               | HTTP | Used by                                           |
| ---------------------------------- | ---- | ------------------------------------------------- |
| `INVALID_CREDENTIALS`              | 401  | login                                             |
| `EMAIL_NOT_VERIFIED`               | 403  | login                                             |
| `EMAIL_ALREADY_REGISTERED`         | 409  | register                                          |
| `EMAIL_ALREADY_VERIFIED`           | 400  | verify-email/confirm                              |
| `OTP_INVALID`                      | 400  | verify-email/confirm, forgot-password/verify-code |
| `OTP_EXPIRED`                      | 400  | same                                              |
| `OTP_MAX_ATTEMPTS`                 | 429  | same                                              |
| `OTP_COOLDOWN`                     | 429  | verify-email/send, forgot-password                |
| `REFRESH_TOKEN_MISSING`            | 401  | refresh                                           |
| `REFRESH_TOKEN_INVALID`            | 401  | refresh                                           |
| `REFRESH_TOKEN_REUSE_DETECTED`     | 401  | refresh                                           |
| `TOKEN_EXPIRED` \| `TOKEN_INVALID` | 401  | authenticate                                      |
| `SESSION_REVOKED`                  | 401  | authenticate (tokenVersion mismatch)              |
| `PASSWORD_UNCHANGED`               | 400  | change-password (same as old)                     |
| `RESET_TOKEN_INVALID`              | 401  | reset-password                                    |
| `VALIDATION_ERROR`                 | 400  | Joi validation failures                           |
| `RATE_LIMITED`                     | 429  | otpLimiter, global limiter                        |
| `FORBIDDEN`                        | 403  | authorize()                                       |
| `INTERNAL_ERROR`                   | 500  | uncaught                                          |

Suggested `ApiError` shape, if not already this:

```js
new ApiError(401, 'Email or password is incorrect', { code: 'INVALID_CREDENTIALS' });
```

and the global handler serializes it as:

```json
{ "success": false, "message": "...", "code": "INVALID_CREDENTIALS" }
```

---

## Finding 3 (Medium) — Language inconsistency in user-facing messages

**Current:** most messages are English (`auth.service.js`,
`auth.controller.js`), but several are Indonesian:

- `user.model.js`: `'Nama wajib diisi'`, `'Format email tidak valid'`, etc.
- `verifyResetToken.middleware.js`: `'Reset token tidak ditemukan'`, `'Reset token tidak valid atau sudah kedaluwarsa'`, `'Token tidak valid untuk aksi ini'`, `'Reset token sudah dipakai atau tidak valid'`
- `otpLimiter.middleware.js`: `'Terlalu banyak percobaan, coba lagi dalam beberapa menit'`
- `auth.validation.js`: `'Kode harus berupa angka'`, `'Password baru tidak boleh sama dengan password lama'`

**Why it matters:** you said the implementation standard is English; a
client rendering these directly will show mixed-language errors to users,
and it makes the codebase harder to keep consistent as it grows (a new
contributor won't know which language new messages should be in).

**Fix:** standardize all _user-facing_ strings to English (code
comments can stay Indonesian if that's the team's convention — that's a
separate, internal-only concern). E.g.:

```js
// user.model.js
required: [true, 'Name is required'],
match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],

// verifyResetToken.middleware.js
throw new ApiError(400, 'Reset token is missing', { code: 'RESET_TOKEN_MISSING' });
throw new ApiError(401, 'Reset token is invalid or has expired', { code: 'RESET_TOKEN_INVALID' });

// otpLimiter.middleware.js
message: { success: false, message: 'Too many attempts, please try again later', code: 'RATE_LIMITED' },
```

If you want actual i18n later (menu boards, receipts, etc. in Indonesian
for staff), that's a bigger, deliberate layer (e.g. `i18next` + an
`Accept-Language`-driven message map) — worth a separate RFC rather than
mixing it in ad hoc.

---

## Finding 4 (Medium) — Rate-limit response doesn't match the API envelope

**Current:** `otpLimiter`'s `message` object is `{ success, message }` —
missing `code`, and it's the _only_ place in the codebase that constructs a
response by hand instead of going through `ApiError`/`ApiResponse`.

**Fix:** shown above (Finding 3) — add `code: 'RATE_LIMITED'` and confirm it
matches whatever envelope your global error handler produces for
`ApiError`, so clients don't need special-case parsing for 429s.

---

## Finding 5 (Medium) — Unhandled Mongo/Mongoose errors likely fall through as raw 500s

**Not directly visible in the files shown, but implied by the code:**

- `register()` does a `findOne` then `create` — there's a race window where
  two concurrent registrations with the same email could both pass the
  `findOne` check and then hit the `email` unique index on `create()`,
  throwing a raw `MongoServerError` with `code: 11000`, not an `ApiError`.
- Mongoose schema validation errors (e.g. password `minlength`) thrown
  outside of Joi validation would similarly surface as raw
  `ValidationError`.

**Fix:** in the global error-handling middleware (wherever `asyncHandler`
errors ultimately land), add explicit mapping _before_ the generic 500
fallback:

```js
if (err.code === 11000) {
  const field = Object.keys(err.keyPattern || {})[0] || 'field';
  return res.status(409).json({
    success: false,
    message: `${field} already in use`,
    code: 'DUPLICATE_FIELD',
  });
}
if (err.name === 'ValidationError') {
  return res.status(400).json({
    success: false,
    message: Object.values(err.errors)
      .map((e) => e.message)
      .join(', '),
    code: 'VALIDATION_ERROR',
  });
}
if (err.name === 'CastError') {
  return res
    .status(400)
    .json({ success: false, message: 'Invalid identifier', code: 'INVALID_ID' });
}
```

And confirm the final fallback never leaks `err.stack` or raw driver error
text in production (`NODE_ENV === 'production'` should switch to a generic
`Internal server error` message while still logging the full error
server-side).

---

## Finding 6 (Low) — Leftover debug logging in `mailer.js`

```js
console.log('DEBUG - API Key loaded:', !!brevoConfig.apiKey, 'length:', brevoConfig.apiKey?.length);
```

Not a functional bug, but: (a) `console.log` bypasses your `logger`
abstraction, so it won't respect log level/output config, and (b) leaving
"DEBUG -" prefixed lines in production logs is a smell even though it
doesn't print the key itself. Remove, or convert to `logger.debug(...)`
gated behind an env check.

---

## Finding 7 (Low) — CSRF exposure from `sameSite: 'none'` cookies

Covered in depth in RFC-0001 §6. Not a code bug per se, but flagged here
because it's an _error-handling-adjacent_ gap: state-changing endpoints
(`/refresh`, `/logout`, `/change-password`) currently have no CSRF check
visible in the reviewed files. Confirm your CORS config restricts
`Access-Control-Allow-Origin` to the exact frontend origin with
`credentials: true`; if that's not airtight, add a CSRF token on top.

---

## Summary — priority order

1. **Fix email enumeration** in verify-email endpoints (Finding 1) — actual
   security gap, small fix.
2. **Add `code` to every `ApiError`** (Finding 2) — mechanical but
   touches every branch; do it once, thoroughly.
3. **Standardize language to English** (Finding 3) — mechanical.
4. **Global handler for Mongo/Mongoose errors** (Finding 5) — prevents raw
   500s/leaked internals.
5. Findings 4, 6, 7 — quick cleanups / verify-and-close items.
