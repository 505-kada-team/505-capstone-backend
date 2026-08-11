const mongoose = require('mongoose');
const { Schema } = mongoose;

const batchUsageSchema = new Schema(
  {
    subInventoryId: { type: Schema.Types.ObjectId, ref: 'SubInventory', required: true },
    batchCode: { type: String, required: true },
    quantityUsed: { type: Number, required: true },
    expired: { type: Date, default: null },
  },
  { _id: false }
);

const ingredientUsageSchema = new Schema(
  {
    inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true },
    nameInventory: { type: String, required: true },
    batches: { type: [batchUsageSchema], default: [] },
  },
  { _id: false }
);

const saleItemSchema = new Schema(
  {
    menuId: { type: Schema.Types.ObjectId, ref: 'Menu', required: true },
    menuName: { type: String, required: true },
    quantitySold: { type: Number, required: true, min: 1 },
    originalPrice: { type: Number, required: true, min: 0 },
    priceUsed: { type: Number, required: true, min: 0 },
    discountApplied: { type: Boolean, required: true, default: false },
    discountPercentage: { type: Number, default: null, min: 1, max: 100 },
    ingredientsUsed: { type: [ingredientUsageSchema], default: [] },
  },
  { _id: false }
);

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
