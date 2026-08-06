const mongoose = require('mongoose');

const { Schema } = mongoose;

// Minimal by design — nameInventory/category/unit/cost are never stored
// here, always read live from Inventory. See doc §2 "Live vs Snapshot".
const menuIngredientSchema = new Schema(
  {
    inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true },
    quantityNeeded: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const menuSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    image: { type: String, default: null },
    sellingPrice: { type: Number, required: true, min: 0 },
    ingredients: {
      type: [menuIngredientSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'Menu must have at least 1 ingredient',
      },
    },
    status: {
      type: String,
      enum: ['active', 'deleted'],
      default: 'active',
    },
    // Terisi hanya jika status: deleted
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Supports GET /api/menu search (name regex) + status filter, and
// GET /api/menu/dropdown (status: active, sorted by name).
menuSchema.index({ status: 1, name: 1 });

module.exports = mongoose.model('Menu', menuSchema);
