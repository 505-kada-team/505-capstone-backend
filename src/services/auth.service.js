const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/user.model');
const RefreshToken = require('../models/refreshToken.model');
const ApiError = require('../utils/ApiError');
const { hashToken } = require('../utils/hashToken');
const { jwt: jwtConfig, otp: otpConfig, singleSessionOnly } = require('../config/env');
const { generateOtp, hashOtp, getOtpExpiry } = require('../utils/otp');
const { sendOtpEmail } = require('../utils/mailer');

// Refresh token TIDAK lagi berupa JWT, tapi random string yang di-hash sebelum
// disimpan (lihat RefreshToken model). Alasan: JWT refresh token tidak bisa
// di-single-use / di-rotasi dengan mudah karena dia stateless by design,
// padahal rotasi butuh state (usedAt, familyId) untuk deteksi reuse.
const REFRESH_TOKEN_TTL_MS = {
  web: 7 * 24 * 60 * 60 * 1000, // 7 hari
  mobile: 30 * 24 * 60 * 60 * 1000, // 30 hari, mobile app jarang sempat refresh manual
};

const generateAccessToken = (user) =>
  // Misal user
  // {
  //   _id: "6871bc1f92c...",
  //   username: "daffa",
  //   email: "daffa@gmail.com",
  //   role: "admin"
  // }
  // isi Payload
  // {
  //   sub: "6871bc1f92c...",
  //   role: "admin"
  // }
  // Jadi token
  // eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  // Validate User dengan token setelah di decode
  // {
  //   "sub": "6871bc1f92c...",
  //   "role": "admin",
  //   "iat": 1752220000,
  //   "exp": 1752223600
  // }
  jwt.sign(
    { sub: user._id, role: user.role, tokenVersion: user.tokenVersion },
    jwtConfig.accessSecret,
    {
      expiresIn: jwtConfig.accessExpires,
    }
  );

/**
 * Terbitkan refresh token baru & simpan hash-nya ke DB.
 * familyId & parentId dioper saat ini adalah hasil ROTASI dari token lama
 * (dipanggil dari refresh()); kalau kosong berarti token pertama di sesi
 * baru (dipanggil dari login()).
 */
const issueRefreshToken = async (
  user,
  { platform, familyId = null, parentId = null, userAgent, ip }
) => {
  const rawRefreshToken = crypto.randomBytes(64).toString('hex');
  const ttlMs = REFRESH_TOKEN_TTL_MS[platform];

  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(rawRefreshToken),
    familyId: familyId || crypto.randomUUID(),
    parentId,
    platform,
    expiresAt: new Date(Date.now() + ttlMs),
    userAgent,
    ip,
  });

  return { refreshToken: rawRefreshToken, refreshTokenTtlMs: ttlMs };
};

const register = async ({ name, email, password }) => {
  try {
    const user = await User.create({ name, email, password });

    await sendVerificationCode(email);

    // TIDAK menerbitkan accessToken/refreshToken di sini secara sengaja,
    // karena user belum verifikasi email -> belum boleh dianggap "login".
    return {
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    };
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, 'Email already registered', { code: 'EMAIL_ALREADY_REGISTERED' });
    }
    throw err;
  }
};

const login = async ({ email, password }, { platform, userAgent, ip }) => {
  const user = await User.findOne({ email }).select('+password +tokenVersion');
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Email or password is incorrect', { code: 'INVALID_CREDENTIALS' });
  }

  if (!user.isEmailVerified) {
    throw new ApiError(403, 'Email has not been verified', { code: 'EMAIL_NOT_VERIFIED' });
  }

  await enforceSingleSession(user);

  const accessToken = generateAccessToken(user);
  const { refreshToken, refreshTokenTtlMs } = await issueRefreshToken(user, {
    platform,
    userAgent,
    ip,
  });

  return {
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
    accessToken,
    refreshToken,
    refreshTokenTtlMs,
  };
};

/**
 * Paksa hanya 1 sesi aktif per user. Begitu device baru login, SEMUA sesi
 * lama (refresh token DAN access token, lewat tokenVersion) langsung mati
 * -- tidak menunggu masa berlaku (exp) JWT habis, karena hanya ada 1 sesi
 * yang boleh hidup jadi tidak ada risiko "salah usir" device lain yang sah.
 *
 * PENTING: function ini menaikkan tokenVersion, jadi HARUS dipanggil
 * SEBELUM generateAccessToken() dijalankan untuk device yang sedang login,
 * supaya access token baru dapat tokenVersion yang sudah ter-update.
 */
const enforceSingleSession = async (user) => {
  if (!singleSessionOnly) return;

  const hasActiveSession = await RefreshToken.exists({
    userId: user._id,
    revokedAt: null,
    usedAt: null,
  });

  if (!hasActiveSession) return; // belum ada sesi lain, tidak perlu evict apa pun

  // Revoke semua refresh token lama milik user ini
  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });

  // Naikkan tokenVersion -> access token device lama mati SEKETIKA di
  // request berikutnya, tidak perlu tunggu exp. Aman dilakukan di sini
  // karena tidak ada device lain yang sah untuk dijaga.
  user.tokenVersion += 1;
  await user.save();
};

const refresh = async (rawToken, { platform, userAgent, ip }) => {
  if (!rawToken) {
    throw new ApiError(401, 'Refresh token not found', { code: 'REFRESH_TOKEN_MISSING' });
  }

  const tokenHash = hashToken(rawToken);

  // findOne dulu untuk membedakan 3 kasus (tidak ketemu / sudah dipakai&revoked / valid),
  // supaya pesan errornya informatif -- bukan sekadar "gagal"
  const existing = await RefreshToken.findOne({ tokenHash });

  if (!existing) {
    throw new ApiError(401, 'Refresh token not recognized', { code: 'REFRESH_TOKEN_INVALID' });
  }

  if (existing.usedAt || existing.revokedAt) {
    await RefreshToken.updateMany(
      { familyId: existing.familyId, revokedAt: null },
      { revokedAt: new Date() }
    );
    throw new ApiError(401, 'Invalid session, please log in again', {
      code: 'REFRESH_TOKEN_REUSE_DETECTED',
    });
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    throw new ApiError(401, 'Refresh token is invalid or expired', {
      code: 'REFRESH_TOKEN_INVALID',
    });
  }

  // Klaim token secara ATOMIC: filter menyertakan usedAt: null, jadi kalau
  // ada request lain yang lebih dulu "mengklaim" token ini, findOneAndUpdate
  // ini akan return null (bukan overwrite silang), dan kita anggap sebagai reuse.
  const stored = await RefreshToken.findOneAndUpdate(
    { _id: existing._id, usedAt: null, revokedAt: null },
    { usedAt: new Date() },
    { new: true }
  );

  if (!stored) {
    // Kalah race -> request lain sudah lebih dulu mengklaim token ini di antara
    // findOne() dan findOneAndUpdate() di atas. Perlakukan sebagai reuse juga.
    await RefreshToken.updateMany(
      { familyId: existing.familyId, revokedAt: null },
      { revokedAt: new Date() }
    );
    throw new ApiError(401, 'Invalid session, please log in again', {
      code: 'REFRESH_TOKEN_REUSE_DETECTED',
    });
  }

  const user = await User.findById(stored.userId).select('+tokenVersion');
  if (!user) {
    throw new ApiError(401, 'Token owner not found', { code: 'SESSION_REVOKED' });
  }

  user.tokenVersion += 1;
  await user.save();

  const accessToken = generateAccessToken(user);

  const { refreshToken, refreshTokenTtlMs } = await issueRefreshToken(user, {
    platform: stored.platform,
    familyId: stored.familyId,
    parentId: stored._id,
    userAgent,
    ip,
  });

  return { accessToken, refreshToken, refreshTokenTtlMs, platform: stored.platform };
};

/**
 * Logout: revoke refresh token milik sesi ini DAN naikkan tokenVersion,
 * supaya access token yang sedang dipegang juga mati SEKETIKA -- tidak
 * menunggu exp (15 menit) habis. Aman menaikkan tokenVersion di sini karena
 * dengan singleSessionOnly hanya ada 1 sesi aktif, jadi tidak ada risiko
 * "salah matikan" device lain yang sah.
 *
 * Dicari berdasarkan rawToken (bukan userId) karena request logout datang
 * dari device itu sendiri -- rawToken sudah cukup untuk tahu siapa user &
 * sesi mana yang harus dimatikan.
 */
const logout = async (rawToken) => {
  if (!rawToken) return;

  const tokenHash = hashToken(rawToken);
  const stored = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null },
    { revokedAt: new Date() }
  );

  if (!stored) return; // token sudah tidak aktif / tidak dikenal, tidak perlu apa pun lagi

  await User.findByIdAndUpdate(stored.userId, { $inc: { tokenVersion: 1 } });
};

/**
 * Force logout user tertentu dari SEMUA sesi aktifnya. Dipakai untuk
 * skenario ADMIN (misal: admin mencurigai akun user lain diretas, paksa
 * logout dari jarak jauh) -- BUKAN untuk self-logout biasa, karena dengan
 * singleSessionOnly, self-logout cukup pakai logout() di atas.
 */
const logoutAllDevices = async (userId) => {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
  await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } });
};

/* -------------------------------------------------------------------------- */
/* Email verification                                                         */
/* -------------------------------------------------------------------------- */

const sendVerificationCode = async (email) => {
  const user = await User.findOne({ email }).select('+emailVerificationSentAt +isEmailVerified');

  // Silently no-op for unknown emails or already-verified accounts —
  // don't leak account existence/state through this endpoint.
  if (!user || user.isEmailVerified) return;

  if (user.emailVerificationSentAt) {
    const secondsSinceLastSend = (Date.now() - user.emailVerificationSentAt.getTime()) / 1000;
    if (secondsSinceLastSend < otpConfig.resendCooldownSeconds) {
      const wait = Math.ceil(otpConfig.resendCooldownSeconds - secondsSinceLastSend);
      throw new ApiError(429, `Wait ${wait} seconds before requesting a new code`, {
        code: 'OTP_COOLDOWN',
      });
    }
  }

  const code = generateOtp();
  user.emailVerificationCode = hashOtp(code);
  user.emailVerificationExpires = getOtpExpiry();
  user.emailVerificationSentAt = new Date();
  user.emailVerificationAttempts = 0;
  await user.save();

  await sendOtpEmail({ to: user.email, code, purpose: 'verify-email' });
};

const confirmVerificationCode = async (email, code) => {
  const user = await User.findOne({ email }).select(
    '+emailVerificationCode +emailVerificationExpires +emailVerificationAttempts +isEmailVerified'
  );

  // Generic error for unknown email or already verified — don't leak account state.
  if (!user || user.isEmailVerified) {
    throw new ApiError(400, 'Invalid or expired code', { code: 'OTP_INVALID' });
  }

  if (!user.emailVerificationCode || !user.emailVerificationExpires) {
    throw new ApiError(400, 'No verification code yet, please request a new code', {
      code: 'OTP_INVALID',
    });
  }

  if (user.emailVerificationAttempts >= otpConfig.maxAttempts) {
    throw new ApiError(429, 'Too many attempts, please request a new code', {
      code: 'OTP_MAX_ATTEMPTS',
    });
  }

  if (user.emailVerificationExpires.getTime() < Date.now()) {
    throw new ApiError(400, 'Code expired, please request a new code', { code: 'OTP_EXPIRED' });
  }

  if (hashOtp(code) !== user.emailVerificationCode) {
    user.emailVerificationAttempts += 1;
    await user.save();
    throw new ApiError(400, 'Invalid code', { code: 'OTP_INVALID' });
  }

  user.isEmailVerified = true;
  user.emailVerificationCode = undefined;
  user.emailVerificationExpires = undefined;
  user.emailVerificationSentAt = undefined;
  user.emailVerificationAttempts = 0;
  await user.save();
};

/* -------------------------------------------------------------------------- */
/* Forgot password (Pattern B: send -> verify-code -> reset-password)         */
/* -------------------------------------------------------------------------- */

const forgotPassword = async (email) => {
  const user = await User.findOne({ email }).select('+resetPasswordSentAt');

  if (!user) return;

  if (user.resetPasswordSentAt) {
    const secondsSinceLastSend = (Date.now() - user.resetPasswordSentAt.getTime()) / 1000;
    if (secondsSinceLastSend < otpConfig.resendCooldownSeconds) {
      return;
    }
  }

  const code = generateOtp();
  user.resetPasswordCode = hashOtp(code);
  user.resetPasswordExpires = getOtpExpiry();
  user.resetPasswordSentAt = new Date();
  user.resetPasswordAttempts = 0;
  await user.save();

  await sendOtpEmail({ to: user.email, code, purpose: 'forgot-password' });
};

const verifyResetCode = async (email, code) => {
  const user = await User.findOne({ email }).select(
    '+resetPasswordCode +resetPasswordExpires +resetPasswordAttempts'
  );

  if (!user || !user.resetPasswordCode || !user.resetPasswordExpires) {
    throw new ApiError(400, 'Invalid code, please request a new code', { code: 'OTP_INVALID' });
  }

  if (user.resetPasswordAttempts >= otpConfig.maxAttempts) {
    throw new ApiError(429, 'Too many attempts, please request a new code', {
      code: 'OTP_MAX_ATTEMPTS',
    });
  }

  if (user.resetPasswordExpires.getTime() < Date.now()) {
    throw new ApiError(400, 'Code expired, please request a new code', { code: 'OTP_EXPIRED' });
  }

  if (hashOtp(code) !== user.resetPasswordCode) {
    user.resetPasswordAttempts += 1;
    await user.save();
    throw new ApiError(400, 'Invalid code', { code: 'OTP_INVALID' });
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  user.resetPasswordCode = undefined;
  user.resetPasswordExpires = undefined;
  user.resetPasswordAttempts = 0;
  user.resetPasswordNonce = nonce;
  await user.save();

  const resetToken = jwt.sign(
    { sub: user._id, purpose: 'reset-password', nonce },
    jwtConfig.resetSecret,
    { expiresIn: jwtConfig.resetExpires }
  );

  return { resetToken };
};

const resetPassword = async (user, newPassword) => {
  user.password = newPassword;
  user.resetPasswordNonce = undefined;
  user.tokenVersion += 1; // matikan semua access token lama
  await user.save();

  // Revoke semua refresh token lama -> paksa login ulang di semua device
  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
};

/* -------------------------------------------------------------------------- */
/* Change password (user sudah login)                                        */
/* -------------------------------------------------------------------------- */

const changePassword = async (userId, oldPassword, newPassword) => {
  const user = await User.findById(userId).select('+password +tokenVersion');
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const isOldPasswordCorrect = await user.comparePassword(oldPassword);
  if (!isOldPasswordCorrect) {
    throw new ApiError(401, 'Old password is incorrect', { code: 'INVALID_CREDENTIALS' });
  }

  const isSameAsOld = await bcrypt.compare(newPassword, user.password);
  if (isSameAsOld) {
    throw new ApiError(400, 'New password cannot be the same as the old password', {
      code: 'PASSWORD_UNCHANGED',
    });
  }

  user.password = newPassword;
  user.tokenVersion += 1; // paksa login ulang di device lain
  await user.save();

  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
};

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAllDevices,
  sendVerificationCode,
  confirmVerificationCode,
  forgotPassword,
  verifyResetCode,
  resetPassword,
  changePassword,
};
