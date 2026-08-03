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
};
