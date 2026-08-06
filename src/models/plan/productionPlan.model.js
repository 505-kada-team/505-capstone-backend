// models/plan/productionPlan.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

// STUB — dibuat sebelum modul Production Plan lengkap ada, supaya Menu
// module (yang butuh flag stale ke sini) bisa jalan tanpa crash.
// Field di bawah HANYA yang dipakai lintas-modul (Menu §5, Inventory §5.5).
// Saat Production Plan v2 spec selesai, EXTEND schema ini — jangan bikin
// file baru — supaya referensi dari Menu/Inventory tetap valid.
const productionPlanSchema = new Schema(
  {
    status: {
      type: String,
      enum: ['draft', 'approved', 'active', 'completed', 'cancelled'],
      default: 'draft',
    },
    menus: [
      {
        menuId: { type: Schema.Types.ObjectId, ref: 'Menu', required: true },
        _id: false,
      },
    ],
    checkResultStale: { type: Boolean, default: false },
    staleReason: {
      type: String,
      enum: [
        // Inventory-originated (lihat 04-inventory-flow.md §5.5)
        'stock_taken',
        'batch_removed',
        'inventory_archived',
        // Menu-originated (lihat menu doc §5 / RFC-0003 §5)
        'recipe_changed',
        'menu_archived',
      ],
      default: null,
    },
  },
  { timestamps: true }
);

productionPlanSchema.index({ status: 1, 'menus.menuId': 1 });

module.exports = mongoose.model('ProductionPlan', productionPlanSchema);
