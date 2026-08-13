const crypto = require('crypto');

/**
 * Hash refresh token sebelum disimpan ke database, alasannya sama seperti
 * kenapa password di-hash: kalau DB bocor, refresh token mentah tidak ikut
 * kepakai. Pakai SHA-256 saja (bukan bcrypt) karena refresh token sudah
 * random 128 karakter hex, tidak butuh salting semahal password.
 */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = { hashToken };
