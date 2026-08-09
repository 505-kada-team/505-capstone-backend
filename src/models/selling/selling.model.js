const mongoose = require('mongoose');

const { Schema } = mongoose;

// Append-only by design -- tidak ada method update/delete untuk model ini
// di selling.service.js (RFC Selling, Open Question #3 diasumsikan belum
// perlu void/edit sampai ada keputusan eksplisit).
const planSaleSchema = new Schema(
  {
    planId: { type: Schema.Types.ObjectId, ref: 'ProductionPlan', required: true },
    menuId: { type: Schema.Types.ObjectId, ref: 'Menu', required: true },

    // BARU -- snapshot nama menu SAAT TRANSAKSI, prinsip sama dengan
    // originalPrice/priceUsed: immutable sejak ditulis, tidak ikut berubah
    // walau Menu di-rename admin belakangan. Diisi dari
    // plan.menus[].frozenMenuName saat createSale() -- BUKAN live-join ke
    // Menu lagi (lihat cross-module reconciliation item #8).
    menuName: { type: String, required: true },

    quantitySold: { type: Number, required: true, min: 1 },

    // Snapshot sellingPrice yang berlaku SAAT transaksi -- untuk plan yang
    // sudah active, ini SELALU frozenSellingPrice, BUKAN Menu.sellingPrice
    // live.
    originalPrice: { type: Number, required: true, min: 0 },

    priceUsed: { type: Number, required: true, min: 0 },
    discountApplied: { type: Boolean, required: true, default: false },
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
