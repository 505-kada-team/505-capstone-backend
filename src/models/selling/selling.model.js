const mongoose = require('mongoose');

const { Schema } = mongoose;

// Append-only by design (RFC §10/§12 Open Question #3 -- diasumsikan TIDAK
// ada edit/void sale sampai ada keputusan eksplisit). Tidak ada method
// update/delete di selling.service.js untuk model ini.
//
// originalPrice & priceUsed disimpan sebagai snapshot GANDA (bukan cuma
// priceUsed) -- immutable sejak ditulis, tidak pernah ikut berubah walau
// plan.menus[].discount diedit/dihapus admin belakangan (RFC §6 D1/D2).
const planSaleSchema = new Schema(
  {
    planId: { type: Schema.Types.ObjectId, ref: 'ProductionPlan', required: true },
    menuId: { type: Schema.Types.ObjectId, ref: 'Menu', required: true },
    quantitySold: { type: Number, required: true, min: 1 },

    // Snapshot sellingPrice yang berlaku SAAT transaksi -- untuk plan yang
    // sudah active, ini SELALU frozenSellingPrice (dibekukan saat approve),
    // BUKAN Menu.sellingPrice live. Lihat catatan konflik RFC di PR/chat.
    originalPrice: { type: Number, required: true, min: 0 },

    // Harga final yang benar-benar dipakai (sudah termasuk diskon jika ada).
    priceUsed: { type: Number, required: true, min: 0 },

    discountApplied: { type: Boolean, required: true, default: false },

    // null kalau discountApplied: false -- enum-nya bukan string jadi cukup
    // divalidasi range saja, konsisten dengan discountSchema di Plan model.
    discountPercentage: { type: Number, default: null, min: 1, max: 100 },

    cashierName: { type: String, required: true, trim: true },

    soldAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

// B3 (history): filter utama by planId, sorted terbaru dulu.
planSaleSchema.index({ planId: 1, soldAt: -1 });

// B3: filter by cashierName independen dari planId (rekonsiliasi shift per
// kasir lintas plan).
planSaleSchema.index({ cashierName: 1, soldAt: -1 });

module.exports = mongoose.model('PlanSale', planSaleSchema);
