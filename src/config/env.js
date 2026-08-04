const Joi = require('joi');

require('dotenv').config();

/**
 * Skema environment variable yang dibutuhkan base code saat ini
 * (server + database + rate limit).
 *
 * Saat fitur baru ditambahkan (misal Authentication), tambahkan
 * variabelnya di sini juga (JWT_*, OTP_*, BREVO_*, dst) supaya
 * validasi tetap terpusat di satu tempat dan gagal cepat kalau
 * ada konfigurasi yang belum di-set.
 */
const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(5000),
  CLIENT_URL: Joi.string().uri().required(),
  MONGO_URI: Joi.string().required().description('Connection string MongoDB'),
  RATE_LIMIT_WINDOW_MS: Joi.number().default(900000),
  RATE_LIMIT_MAX: Joi.number().default(100),
  JWT_ACCESS_SECRET: Joi.string().min(20).required(),
  JWT_ACCESS_EXPIRES: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(20).required(),
  JWT_REFRESH_EXPIRES: Joi.string().default('7d'),
  JWT_RESET_SECRET: Joi.string().min(20).required(),
  JWT_RESET_EXPIRES: Joi.string().default('10m'),
  BREVO_API_KEY: Joi.string().required(),
  SMTP_USER: Joi.string().required(),
  SMTP_FROM_NAME: Joi.string().default('Capstone App'),
  OTP_LENGTH: Joi.number().default(6),
  OTP_EXPIRES_MINUTES: Joi.number().default(10),
  OTP_RESEND_COOLDOWN_SECONDS: Joi.number().default(60),
  OTP_MAX_ATTEMPTS: Joi.number().default(5),
})
  .unknown(true)
  .required();

const { value: envVars, error } = envSchema.validate(process.env);

if (error) {
  // Sengaja crash di awal (fail fast) daripada error tidak jelas di tengah request.
  throw new Error(`Config validation error: ${error.message}`);
}

module.exports = {
  env: envVars.NODE_ENV,
  isProduction: envVars.NODE_ENV === 'production',
  isTest: envVars.NODE_ENV === 'test',
  port: envVars.PORT,
  clientUrl: envVars.CLIENT_URL,
  mongoUri: envVars.MONGO_URI,
  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
    max: envVars.RATE_LIMIT_MAX,
  },
  jwt: {
    accessSecret: envVars.JWT_ACCESS_SECRET,
    accessExpires: envVars.JWT_ACCESS_EXPIRES,
    refreshSecret: envVars.JWT_REFRESH_SECRET,
    refreshExpires: envVars.JWT_REFRESH_EXPIRES,
    resetSecret: envVars.JWT_RESET_SECRET,
    resetExpires: envVars.JWT_RESET_EXPIRES,
  },
  brevo: {
    apiKey: envVars.BREVO_API_KEY,
    fromEmail: envVars.SMTP_USER,
    fromName: envVars.SMTP_FROM_NAME,
  },
  otp: {
    length: envVars.OTP_LENGTH,
    expiresMinutes: envVars.OTP_EXPIRES_MINUTES,
    resendCooldownSeconds: envVars.OTP_RESEND_COOLDOWN_SECONDS,
    maxAttempts: envVars.OTP_MAX_ATTEMPTS,
  },
  singleSessionOnly: true,
};
