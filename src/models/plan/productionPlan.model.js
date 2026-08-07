const mongoose = require('mongoose');

const { Schema } = mongoose;

// Model ini adalah EXTENSION dari stub yang dibuat tim Menu — path
// (`models/plan/productionPlan.model.js`) dan nama model ('ProductionPlan')
// SENGAJA dipertahankan sama persis, karena menu.service.js (dan kemungkinan
// inventory.service.js) sudah require dari path ini untuk flag stale
// (checkResultStale/staleReason). Jangan pindahkan/duplikasi file ini —
// itu akan memicu OverwriteModelError begitu dua file sama-sama register
// 'ProductionPlan'.
//
// Perubahan dari versi stub:
// - status enum: DIHAPUS 'approved' (tidak ada state antara — approve
//   adalah draft -> active langsung, satu langkah, sesuai dokumen §1
//   "Tetap satu langkah"), DITAMBAH 'stopped' (state yang memang ada di
//   dokumen, sebelumnya hilang dari stub).
// - staleReason enum: ditambahkan `null` secara eksplisit ke dalam enum
//   array. Tanpa ini, Mongoose menolak assignment `staleReason = null`
//   saat refresh (A5)/edit (A4) mereset flag stale — enum validator hanya
//   meloloskan `undefined` secara default, BUKAN `null`, kecuali `null`
//   ikut terdaftar di array enum.
// - menus[]/checkResult[]/committedIngredients[] dilengkapi sesuai skema
//   Production Plan v2 (field menuId tetap dipertahankan di posisi yang
//   sama supaya query `'menus.menuId': menuId` milik Menu module tetap valid).

const discountSchema = new Schema(
  {
    discountPercentage: { type: Number, required: true, min: 1, max: 100 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    reason: { type: String, default: '' },
    setBy: { type: String, required: true },
    setAt: { type: Date, required: true },
  },
  { _id: false }
);

const planMenuSchema = new Schema(
  {
    menuId: { type: Schema.Types.ObjectId, ref: 'Menu', required: true },
    quantityPlanned: { type: Number, required: true, min: 1 },
    soldQuantity: { type: Number, default: 0 },
    lossQuantity: { type: Number, default: 0 },
    soldOutAt: { type: Date, default: null },
    frozenSellingPrice: { type: Number, default: null },
    discount: { type: discountSchema, default: null },
  },
  { _id: false }
);

const eligibleBatchSchema = new Schema(
  {
    subInventoryId: { type: Schema.Types.ObjectId, ref: 'SubInventory', required: true },
    quantityTaken: { type: Number, required: true },
    expired: { type: Date, default: null },
    batchSafetyStatus: { type: String, enum: ['safe', 'unsafe'], required: true },
  },
  { _id: false }
);

const checkResultSchema = new Schema(
  {
    inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true },
    nameInventory: { type: String, required: true },
    quantityNeeded: { type: Number, required: true },
    sufficient: { type: Boolean, required: true },
    availableQuantity: { type: Number, required: true },
    shortfall: { type: Number },
    hasUnsafeBatch: { type: Boolean, default: false },
    eligibleBatches: { type: [eligibleBatchSchema], default: [] },
  },
  { _id: false }
);

const committedBatchSchema = new Schema(
  {
    subInventoryId: { type: Schema.Types.ObjectId, ref: 'SubInventory', required: true },
    quantityUsed: { type: Number, required: true },
    costPriceUsed: { type: Number, required: true },
    batchSafetyStatus: { type: String, enum: ['safe', 'unsafe'], required: true },
  },
  { _id: false }
);

const committedIngredientSchema = new Schema(
  {
    inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true },
    nameInventory: { type: String, required: true },
    quantityNeeded: { type: Number, required: true },
    batches: { type: [committedBatchSchema], default: [] },
  },
  { _id: false }
);

const productionPlanSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    tags: { type: [String], default: [] },

    menus: {
      type: [planMenuSchema],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'Plan harus punya minimal 1 menu',
      },
    },

    startDate: { type: Date, required: true },
    duration: { type: Number, required: true, min: 7, max: 30 },
    endDate: { type: Date, required: true },

    status: {
      type: String,
      enum: ['draft', 'active', 'completed', 'stopped', 'cancelled'],
      default: 'draft',
    },

    checkResult: { type: [checkResultSchema], default: [] },
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
        // wajib eksplisit di enum, bukan cuma default, lihat catatan di atas
        null,
      ],
      default: null,
    },
    readyToApprove: { type: Boolean, default: false },

    committedIngredients: { type: [committedIngredientSchema], default: [] },

    hasPendingLossReplacement: { type: Boolean, default: false },

    approvedAt: { type: Date, default: null },
    approvedBy: { type: String, default: null },

    stoppedAt: { type: Date, default: null },
    stoppedBy: { type: String, default: null },
    stopReason: { type: String, default: null },

    cancelledAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Dipertahankan dari stub (urutan field sama) — dipakai menu.service.js's
// flagDraftPlansStale query: { status: 'draft', 'menus.menuId': menuId }.
productionPlanSchema.index({ status: 1, 'menus.menuId': 1 });

// Tambahan untuk kebutuhan Inventory's equivalent flagging (batch_removed /
// inventory_archived) — belum dikonfirmasi ke kode inventory.service.js
// aslinya, tapi field yang di-query (checkResult.inventoryId /
// checkResult.eligibleBatches.subInventoryId) sudah ada di skema ini.
productionPlanSchema.index({ status: 1, 'checkResult.inventoryId': 1 });
productionPlanSchema.index({ status: 1, 'checkResult.eligibleBatches.subInventoryId': 1 });

// Hanya boleh 1 plan `active` pada satu waktu (global lock) — safety net
// di level DB, bukan pengganti pengecekan transactional di service.
productionPlanSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'only_one_active_plan',
  }
);

module.exports = mongoose.model('ProductionPlan', productionPlanSchema);
