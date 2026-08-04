const rateLimit = require('express-rate-limit');

/**
 * Rate limit lebih ketat untuk endpoint yang mengirim/verifikasi OTP.
 * Rate limit global di app.js (100 req/15menit) terlalu longgar untuk
 * endpoint yang berpotensi di-brute-force (misal coba banyak kode OTP).
 *
 * Dikunci per kombinasi IP + email di body, bukan cuma IP, supaya satu
 * kantor/wifi kampus (banyak mahasiswa 1 network) tidak saling ke-block.
 */
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}-${req.body?.email || 'unknown'}`,
  message: {
    success: false,
    message: 'Too many attempts, please try again later',
    code: 'RATE_LIMITED',
  },
});

module.exports = otpLimiter;
