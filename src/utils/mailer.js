const { BrevoClient } = require('@getbrevo/brevo');
const { brevo: brevoConfig } = require('../config/env');
const logger = require('./logger');

// Dibuat sekali (singleton client), sama seperti transporter sebelumnya
const brevo = new BrevoClient({
  apiKey: brevoConfig.apiKey?.trim(),
});

// GANTI (baru): flag sandbox, dibaca dari env var
const isSandbox = process.env.EMAIL_SANDBOX_MODE === 'true';

/**
 * Kirim email generik. Dipakai oleh service verify-email dan forgot-password.
 */
const sendEmail = async ({ to, subject, html }) => {
  try {
    await brevo.transactionalEmails.sendTransacEmail({
      sender: { name: brevoConfig.fromName, email: brevoConfig.fromEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      // GANTI (baru): sandbox header ikut masuk body, bukan HTTP header
      ...(isSandbox && { headers: { 'X-Sib-Sandbox': 'drop' } }),
    });

    if (isSandbox) {
      logger.info(`[SANDBOX] Email ke ${to} divalidasi, tidak benar-benar dikirim`);
    }
  } catch (err) {
    logger.error(`Gagal mengirim email ke ${to}: ${err.message}`);
    // Sengaja tidak throw ApiError di sini, biar caller (service) yang putuskan
    // bagaimana meng-handle kegagalan kirim email (misal tetap 200 tapi log warning)
    throw err;
  }
};

const sendOtpEmail = async ({ to, code, purpose }) => {
  const subject =
    purpose === 'verify-email' ? 'Kode verifikasi email kamu' : 'Kode reset password kamu';

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>${subject}</h2>
      <p>Gunakan kode berikut, berlaku selama 10 menit:</p>
      <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px;">${code}</p>
      <p>Jika kamu tidak meminta ini, abaikan email ini.</p>
    </div>
  `;

  await sendEmail({ to, subject, html });
};

module.exports = { sendEmail, sendOtpEmail };
