const express = require('express');
const {
  register,
  sendVerificationEmail,
  confirmVerificationEmail,
  forgotPassword,
  verifyResetCode,
  login,
  resetPassword,
  changePassword,
  refresh,
  logout,
  me,
} = require('../controllers/auth.controller');
const validate = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const verifyResetToken = require('../middlewares/verifyResetToken.middleware');
const authValidation = require('../validations/auth.validation');
const otpLimiter = require('../middlewares/otpLimiter.middleware');

const router = express.Router();

// --- Email verification (send == resend, satu endpoint saja) ---
router.post(
  '/verify-email/send',
  otpLimiter,
  validate(authValidation.sendVerificationEmail),
  sendVerificationEmail
);
router.post(
  '/verify-email/confirm',
  otpLimiter,
  validate(authValidation.confirmVerificationEmail),
  confirmVerificationEmail
);

// --- Forgot password (Pattern B: 3 langkah) ---
router.post(
  '/forgot-password',
  otpLimiter,
  validate(authValidation.forgotPassword),
  forgotPassword
);
router.post(
  '/forgot-password/verify-code',
  otpLimiter,
  validate(authValidation.verifyResetCode),
  verifyResetCode
);
router.post(
  '/reset-password',
  validate(authValidation.resetPassword),
  verifyResetToken,
  resetPassword
);

router.post('/register', validate(authValidation.register), register);
router.post('/login', validate(authValidation.login), login);

// --- Change password (user sudah login) ---
router.patch(
  '/change-password',
  authenticate,
  validate(authValidation.changePassword),
  changePassword
);

router.post('/refresh', validate(authValidation.refresh), refresh);
router.post('/logout', logout);
// router.post('/logout-all-devices', authenticate, logoutAllDevices);
router.get('/me', authenticate, me);

module.exports = router;
