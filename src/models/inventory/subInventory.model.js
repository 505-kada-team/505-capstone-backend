const mongoose = require('mongoose');

const { Schema } = mongoose;

const subInventorySchema = new Schema(
  {
    inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true },
    batchCode: { type: String, required: true, unique: true },
    quantity: { type: Number, required: true, min: 0 },
    initialQuantity: { type: Number, required: true, min: 0 }, // BARU — snapshot qty saat batch dibuat, immutable
    costPrices: { type: Number, required: true, min: 0 },
    inDate: { type: Date, required: true, default: Date.now },
    expired: { type: Date, default: null },
    status: {
      type: String,
      enum: ['active', 'depleted', 'expired', 'deleted'],
      default: 'active',
    },
  },
  { timestamps: true }
);

// Supports both the FEFO query (active batches for one item, sorted by expiry)
// and the lazy-expiry sweep (active batches whose expired date has passed).
subInventorySchema.index({ inventoryId: 1, status: 1, expired: 1 });

module.exports = mongoose.model('SubInventory', subInventorySchema);
