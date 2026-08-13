const mongoose = require('mongoose');

const { Schema } = mongoose;

// Append-only. One row per (batch, deduction) pair, created by FEFO deduction.
// Never deleted — reversal is modeled as a flag (isReversed), not a delete,
// so the log stays a true audit trail.
const historyUsageSchema = new Schema(
  {
    inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true },
    subInventoryId: { type: Schema.Types.ObjectId, ref: 'SubInventory', required: true },
    nameInventory: { type: String, required: true },
    batchCode: { type: String, required: true },
    quantityUsed: { type: Number, required: true },
    // Actual COGS for this row — the batch FEFO actually took, not the
    // newest-purchase estimate cached on Inventory.lastCostBatch.
    costPriceUsed: { type: Number, required: true },
    // Opaque caller-supplied reference (e.g. a future Production Plan's id).
    // Inventory doesn't know what a "Plan" is — it just stores the string.
    reference: { type: String, default: null },
    availableUntil: { type: Date, default: null },
    batchSafetyStatus: { type: String, enum: ['safe', 'unsafe', null], default: null },
    isReversed: { type: Boolean, default: false },
    reversedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

historyUsageSchema.index({ reference: 1 });
historyUsageSchema.index({ inventoryId: 1, createdAt: -1 });

module.exports = mongoose.model('HistoryUsage', historyUsageSchema);
