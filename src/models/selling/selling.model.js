const mongoose = require('mongoose');
const { Schema } = mongoose;

// Snapshot 1 baris item di dalam 1 transaksi checkout. _id: false karena
// item ini bukan entitas independen -- immutable sejak ditulis, sama
// prinsipnya dengan originalPrice/priceUsed di versi lama.
const saleItemSchema = new Schema(
  {
    menuId: { type: Schema.Types.ObjectId, ref: 'Menu', required: true },
    menuName: { type: String, required: true },
    quantitySold: { type: Number, required: true, min: 1 },
    originalPrice: { type: Number, required: true, min: 0 },
    priceUsed: { type: Number, required: true, min: 0 },
    discountApplied: { type: Boolean, required: true, default: false },
    discountPercentage: { type: Number, default: null, min: 1, max: 100 },
  },
  { _id: false }
);

// BERUBAH MAKNA: 1 dokumen sekarang = 1 transaksi/checkout (1 struk),
// BUKAN 1 item terjual. Append-only, tidak ada update/delete method,
// sama seperti sebelumnya.
const planSaleSchema = new Schema(
  {
    planId: { type: Schema.Types.ObjectId, ref: 'ProductionPlan', required: true },
    cashierName: { type: String, required: true, trim: true },
    soldAt: { type: Date, required: true, default: Date.now },
    items: {
      type: [saleItemSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'Transaksi harus punya minimal 1 item',
      },
    },
  },
  { timestamps: true }
);

planSaleSchema.index({ planId: 1, soldAt: -1 });
planSaleSchema.index({ cashierName: 1, soldAt: -1 });

module.exports = mongoose.model('PlanSale', planSaleSchema);
