const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const authService = require('../services/auth.service');

// const cookieOptions = {
//   httpOnly: true,
//   secure: process.env.NODE_ENV === 'production',
//   sameSite: 'strict',
//   maxAge: 7 * 24 * 60 * 60 * 1000,
// };

const cookieOptions = {
  httpOnly: true,
  secure: true, // WAJIB true karena backend selalu diakses via https (Render)
  sameSite: 'none', // WAJIB none karena frontend & backend beda domain (cross-site)
  path: '/', // pastikan cookie berlaku di semua path, bukan cuma /auth
  maxAge: 7 * 24 * 60 * 60 * 1000, // samakan dengan REFRESH_TOKEN_TTL_MS.web di service
};

const getPlatform = (req) => (req.headers['x-platform'] === 'mobile' ? 'mobile' : 'web');

const register = asyncHandler(async (req, res) => {
  const { user } = await authService.register(req.body);
  // Tidak set cookie / kirim token di sini, karena user belum verifikasi
  // email -> service memang sengaja tidak menerbitkan token (lihat auth.service.js).
  return new ApiResponse(
    201,
    { user },
    'Registration successful, please check your email for verification'
  ).send(res);
});

const login = asyncHandler(async (req, res) => {
  const platform = getPlatform(req);
  const isMobile = platform === 'mobile';

  const { user, accessToken, refreshToken } = await authService.login(req.body, {
    platform,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });

  if (!isMobile) {
    res.cookie('refreshToken', refreshToken, cookieOptions);

    return new ApiResponse(200, { user, accessToken }, 'Login successful').send(res);
  }

  return new ApiResponse(200, { user, accessToken, refreshToken }, 'Login successful').send(res);
});

const refresh = asyncHandler(async (req, res) => {
  const platform = getPlatform(req);
  const isMobile = platform === 'mobile';

  const token = req.cookies?.refreshToken || req.body.refreshToken;

  if (!token) {
    throw new ApiError(401, 'Refresh token not found', { code: 'REFRESH_TOKEN_MISSING' });
  }

  let result;
  try {
    result = await authService.refresh(token, {
      platform,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
  } catch (err) {
    // Refresh gagal (invalid/expired/reuse terdeteksi) -> bersihkan cookie
    // basi di browser supaya user tidak terus2an kirim token yang sudah mati
    if (!isMobile) res.clearCookie('refreshToken', cookieOptions);
    throw err;
  }

  const { accessToken, refreshToken } = result;

  if (!isMobile) {
    res.cookie('refreshToken', refreshToken, cookieOptions);
    return new ApiResponse(200, { accessToken }, 'Token refreshed successfully').send(res);
  }

  return new ApiResponse(200, { accessToken, refreshToken }, 'Token refreshed successfully').send(
    res
  );
});

const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken || req.body.refreshToken;

  await authService.logout(token);
  res.clearCookie('refreshToken', cookieOptions);

  return new ApiResponse(200, null, 'Logout successful').send(res);
});

// Butuh middleware authenticate di route-nya, karena revoke berdasarkan req.user._id
const logoutAllDevices = asyncHandler(async (req, res) => {
  await authService.logoutAllDevices(req.user._id);
  res.clearCookie('refreshToken', cookieOptions);

  return new ApiResponse(200, null, 'Successfully logged out from all devices').send(res);
});

const me = asyncHandler(async (req, res) => {
  return new ApiResponse(200, req.user, 'User data retrieved successfully').send(res);
});

/* --- Email verification --- */

const sendVerificationEmail = asyncHandler(async (req, res) => {
  await authService.sendVerificationCode(req.body.email);
  return new ApiResponse(200, null, 'Verification code has been sent to your email').send(res);
});

const confirmVerificationEmail = asyncHandler(async (req, res) => {
  await authService.confirmVerificationCode(req.body.email, req.body.code);
  return new ApiResponse(200, null, 'Email verified successfully').send(res);
});

/* --- Forgot password --- */

const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body.email);
  return new ApiResponse(200, null, 'If the email is registered, a reset code has been sent').send(
    res
  );
});

const verifyResetCode = asyncHandler(async (req, res) => {
  const result = await authService.verifyResetCode(req.body.email, req.body.code);
  return new ApiResponse(200, result, 'Code verified').send(res);
});

const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.resetUser, req.body.newPassword);
  return new ApiResponse(200, null, 'Password reset successfully, please log in again').send(res);
});

/* --- Change password (protected) --- */

const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.user._id, req.body.oldPassword, req.body.newPassword);
  return new ApiResponse(
    200,
    null,
    'Password changed successfully, please log in again on other devices'
  ).send(res);
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAllDevices,
  me,
  sendVerificationEmail,
  confirmVerificationEmail,
  forgotPassword,
  verifyResetCode,
  resetPassword,
  changePassword,
};
