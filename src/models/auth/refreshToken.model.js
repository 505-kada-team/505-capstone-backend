const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    // Token yang saling menggantikan (hasil rotasi) berbagi familyId yang sama.
    // Dipakai untuk reuse detection: kalau ada token lama dalam family ini
    // dipakai lagi padahal sudah digantikan, berarti kemungkinan token dicuri.
    familyId: {
      type: String,
      required: true,
      index: true,
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RefreshToken',
      default: null,
    },
    platform: {
      type: String,
      enum: ['web', 'mobile'],
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    // Terisi begitu token ini dipakai untuk hit /refresh. Refresh token
    // bersifat single-use, jadi begitu usedAt terisi dia tidak boleh dipakai lagi
    // meskipun expiresAt belum lewat.
    usedAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    userAgent: {
      type: String,
      default: '',
    },
    ip: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

// TTL index: MongoDB otomatis hapus dokumen setelah expiresAt lewat,
// tidak perlu cron job manual untuk bersih-bersih token kedaluwarsa.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
