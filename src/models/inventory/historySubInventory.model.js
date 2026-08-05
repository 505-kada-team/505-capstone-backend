const mongoose = require('mongoose');

const { Schema } = mongoose;

// Append-only. One row per batch ever added. Never updated or deleted.
// Snapshot fields (nameInventory, itemCode, category, unit) are captured
// at write time so this log stays fully readable even after the parent
// Inventory is archived — no join needed on read.
const historySubInventorySchema = new Schema(
  {
    inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true },
    subInventoryId: { type: Schema.Types.ObjectId, ref: 'SubInventory', required: true },
    nameInventory: { type: String, required: true },
    itemCode: { type: String, required: true },
    category: { type: String, required: true },
    unit: { type: String, required: true },
    batchCode: { type: String, required: true },
    quantity: { type: Number, required: true },
    costPrices: { type: Number, required: true },
    inDate: { type: Date, required: true },
    expired: { type: Date, default: null },
  },
  { timestamps: true }
);

historySubInventorySchema.index({ inventoryId: 1, createdAt: -1 });

module.exports = mongoose.model('HistorySubInventory', historySubInventorySchema);
