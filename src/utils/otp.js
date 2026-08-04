const crypto = require('crypto');
const { otp: otpConfig } = require('../config/env');

/**
 * Generate kode OTP numerik, contoh: "482913" untuk length 6.
 */
const generateOtp = () => {
  const min = 10 ** (otpConfig.length - 1);
  const max = 10 ** otpConfig.length - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
};

/**
 * Hash kode OTP sebelum disimpan ke DB. Pakai SHA-256 (bukan bcrypt) karena
 * OTP itu secret berumur pendek (menit), bukan secret jangka panjang seperti
 * password, jadi tidak butuh cost factor bcrypt yang berat.
 */
const hashOtp = (code) => crypto.createHash('sha256').update(code).digest('hex');

const getOtpExpiry = () => new Date(Date.now() + otpConfig.expiresMinutes * 60 * 1000);

module.exports = { generateOtp, hashOtp, getOtpExpiry };
