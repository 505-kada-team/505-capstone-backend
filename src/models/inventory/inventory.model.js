const mongoose = require('mongoose');

const { Schema } = mongoose;

const inventorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // Short code derived from name, used as the prefix for batchCode (see utils/batchCode.js)
    itemCode: { type: String, required: true, trim: true, uppercase: true },
    category: { type: String, enum: ['ingredients', 'packaging'], required: true },
    unit: {
      type: String,
      required: true,
      trim: true,
      enum: {
        values: ['kg', 'gr', 'liter', 'ml', 'pcs'],
        message: '`unit` must be one of: kg, gr, liter, ml, pcs',
      },
    },
    description: { type: String, default: '' },
    status: { type: String, enum: ['active', 'deleted'], default: 'active' },

    // --- Cached / derived fields. NEVER write these directly from a route
    // handler — always go through recomputeInventoryCache() so they can
    // never drift from the actual sum over active SubInventory docs. ---
    quantityTotal: { type: Number, default: 0 },
    totalSubInventory: { type: Number, default: 0 },
    lastCostBatch: { type: Number, default: 0 },
    lastBatchInitialQuantity: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Duplicate-name guard: case-insensitive, scoped to category, active only.
// Backstop for the regex check already done in the service layer — a
// unique-index race still gets caught here and mapped to 409 via code 11000.
inventorySchema.index(
  { name: 1, category: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    partialFilterExpression: { status: 'active' },
  }
);

module.exports = mongoose.model('Inventory', inventorySchema);
