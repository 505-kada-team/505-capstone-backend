const mongoose = require('mongoose');

const { Schema } = mongoose;

// ... (bagian atas file identik dengan versi sebelumnya, lihat komentar
// asli soal path/nama model yang WAJIB dipertahankan, status enum, dst.
// Hanya planMenuSchema yang berubah di sini -- lihat field frozenMenuName.)

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

const frozenRecipeItemSchema = new Schema(
  {
    inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true },
    nameInventory: { type: String, required: true },
    unit: { type: String, required: true }, // BARU
    // Snapshot dari menuDoc.ingredients[].quantityNeeded (per 1 porsi) SAAT
    // approve -- basis buat mecah committedIngredients (plan-level, pooled)
    // balik jadi breakdown per-menu yang akurat, independen dari resep Menu
    // yang mungkin berubah belakangan.
    quantityPerUnit: { type: Number, required: true, min: 0 },
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
    frozenMenuName: { type: String, default: null },
    // BARU -- dibekukan bareng frozenMenuName/frozenSellingPrice. Dipakai
    // Selling module (GET /selling/active) supaya tidak live-join ke Menu.
    frozenMenuImage: { type: String, default: null },
    // BARU -- dibekukan saat approve. Basis computeCommittedIngredientsDetail
    // (planCompute.js) DAN basis per-sale FEFO decrement di Selling module
    // (rencana ke depan, lihat diskusi committedIngredients[].batches[].quantityRemaining).
    frozenRecipe: { type: [frozenRecipeItemSchema], default: [] },
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
    unit: { type: String, required: true }, // BARU
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
    batchCode: { type: String, required: true },
    quantityUsed: { type: Number, required: true }, // total original saat approve (audit + basis cost)
    quantityRemaining: { type: Number, required: true }, // live, di-decrement createSale
    costPriceUsed: { type: Number, required: true },
    batchSafetyStatus: { type: String, enum: ['safe', 'unsafe'], required: true },
    expired: { type: Date, default: null },
  },
  { _id: false }
);

const committedIngredientSchema = new Schema(
  {
    inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true },
    nameInventory: { type: String, required: true },
    unit: { type: String, required: true }, // BARU
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
        'stock_taken',
        'batch_removed',
        'inventory_archived',
        'inventory_added',
        'recipe_changed',
        'menu_archived',
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

productionPlanSchema.index({ status: 1, 'menus.menuId': 1 });
productionPlanSchema.index({ status: 1, 'checkResult.inventoryId': 1 });
productionPlanSchema.index({ status: 1, 'checkResult.eligibleBatches.subInventoryId': 1 });

productionPlanSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'only_one_active_plan',
  }
);

module.exports = mongoose.model('ProductionPlan', productionPlanSchema);
