const mongoose = require('mongoose');
const Inventory = require('../models/inventory/inventory.model');
const SubInventory = require('../models/inventory/subInventory.model');
const HistorySubInventory = require('../models/inventory/historySubInventory.model');
const HistoryUsage = require('../models/inventory/historyUsage.model');
const ProductionPlan = require('../models/plan/productionPlan.model');
const ApiError = require('../utils/ApiError');
const { deriveItemCode, generateBatchCode } = require('../utils/batchCode');
const { planFefoDeduction, daysUntilExpiry } = require('../utils/fefo');
const { toBaseUnitPrice } = require('../utils/unitConversion');

// ---------------------------------------------------------------------------
// §5.2 One shared recompute function — every endpoint that changes a batch
// must call this, inside the same transaction, instead of ad hoc arithmetic.
// ---------------------------------------------------------------------------
async function recomputeInventoryCache(inventoryId, session) {
  const [result] = await SubInventory.aggregate([
    { $match: { inventoryId: new mongoose.Types.ObjectId(inventoryId), status: 'active' } },
    { $sort: { inDate: -1 } },
    {
      $group: {
        _id: null,
        quantityTotal: { $sum: '$quantity' },
        totalSubInventory: { $sum: 1 },
        lastCostBatch: { $first: '$costPrices' },
        lastBatchInitialQuantity: { $first: '$initialQuantity' }, // ganti dari lastBatchQuantity
      },
    },
  ]).session(session);

  await Inventory.findByIdAndUpdate(
    inventoryId,
    {
      quantityTotal: result ? result.quantityTotal : 0,
      totalSubInventory: result ? result.totalSubInventory : 0,
      lastCostBatch: result ? result.lastCostBatch : 0,
      lastBatchInitialQuantity: result ? result.lastBatchInitialQuantity : 0, // BARU
    },
    { session }
  );
}

// ---------------------------------------------------------------------------
// Lazy expiry sweep — run before any read that exposes batch status.
// ---------------------------------------------------------------------------
async function lazyExpireBatches(inventoryId, session) {
  const now = new Date();
  const result = await SubInventory.updateMany(
    { inventoryId, status: 'active', expired: { $ne: null, $lt: now } },
    { $set: { status: 'expired' } },
    { session }
  );
  if (result.modifiedCount > 0) {
    await recomputeInventoryCache(inventoryId, session);
  }
}

// §5.5 Stale-flag propagation. Production Plan module doesn't exist yet in
// this codebase, so this is a documented no-op hook — wire it up to the
// Plan collection once that module lands. Kept as its own function so the
// call sites (delete inventory / delete batch) don't need to change later.
// eslint-disable-next-line no-unused-vars
async function propagateStale(inventoryId, subInventoryId, staleReason, session) {
  const filter = {
    status: 'draft',
    'checkResult.inventoryId': inventoryId,
  };

  // batch_removed harus match subInventoryId spesifik di dalam eligible
  // batches, bukan sekadar inventoryId — supaya draft yang FEFO-plan-nya
  // tidak menyentuh batch yang dihapus tidak ikut ditandai stale.
  if (staleReason === 'batch_removed' && subInventoryId) {
    filter['checkResult.eligibleBatches.subInventoryId'] = subInventoryId;
  }

  await ProductionPlan.updateMany(
    filter,
    { $set: { checkResultStale: true, staleReason } },
    { session }
  );
}

function toBatchDTO(sub) {
  return {
    id: sub._id,
    inventoryId: sub.inventoryId,
    batchCode: sub.batchCode,
    quantity: sub.quantity,
    costPrices: sub.costPrices,
    inDate: sub.inDate,
    expired: sub.expired,
    daysUntilExpiry: daysUntilExpiry(sub.expired),
    status: sub.status,
  };
}

// ---------------------------------------------------------------------------
// Inventory CRUD
// ---------------------------------------------------------------------------

async function createInventory(data) {
  const itemCode = data.itemCode || deriveItemCode(data.name);

  // Pre-check (fast path, friendly error). The unique index is the real
  // guarantee against races — see errorHandler's handling of code 11000.
  const existing = await Inventory.findOne({
    name: { $regex: `^${escapeRegex(data.name)}$`, $options: 'i' },
    category: data.category,
    status: 'active',
  });
  if (existing) {
    throw new ApiError(
      409,
      `Inventory "${data.name}" already exists in category "${data.category}".`
    );
  }

  const inventory = await Inventory.create({
    name: data.name,
    itemCode,
    category: data.category,
    unit: data.unit,
    description: data.description || '',
  });
  return inventory;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listInventory(query) {
  const { page, limit, category, search, includeDeleted } = query;
  const filter = {};
  if (!includeDeleted) filter.status = 'active';
  if (category) filter.category = category;
  if (search) filter.name = { $regex: escapeRegex(search), $options: 'i' };

  const [items, total] = await Promise.all([
    Inventory.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Inventory.countDocuments(filter),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

async function dropdownInventory() {
  const items = await Inventory.find({ status: 'active' })
    .select(
      '_id name itemCode category unit lastCostBatch lastBatchInitialQuantity totalSubInventory'
    )
    .sort({ name: 1 });

  return items.map((i) => {
    const hasBatch = i.totalSubInventory > 0 && i.lastBatchInitialQuantity > 0;
    const lastCostBatch = hasBatch ? i.lastCostBatch : null;
    const pricePerUnit = hasBatch ? i.lastCostBatch / i.lastBatchInitialQuantity : null;
    const { baseUnit, pricePerBaseUnit } = toBaseUnitPrice(pricePerUnit, i.unit);

    return {
      _id: i._id,
      name: i.name,
      itemCode: i.itemCode,
      category: i.category,
      unit: i.unit,
      lastCostBatch, // total harga borongan batch terakhir, untuk display
      lastCostPricePerUnit: pricePerUnit, // harga per kg/liter/pcs
      baseUnit,
      lastCostPricePerBaseUnit: pricePerBaseUnit, // harga per gr/ml — dipakai HPP
    };
  });
}

async function getInventoryDetail(id) {
  const inventory = await Inventory.findById(id);
  if (!inventory) throw new ApiError(404, 'Inventory not found.');

  await lazyExpireBatches(id, null);

  const batches = await SubInventory.find({ inventoryId: id, status: { $ne: 'deleted' } }).sort({
    expired: 1,
  });

  return {
    ...inventory.toObject(),
    batches: batches.map(toBatchDTO),
  };
}

async function updateInventory(id, data) {
  const inventory = await Inventory.findOne({ _id: id, status: 'active' });
  if (!inventory) throw new ApiError(404, 'Inventory not found.');

  if (data.name !== undefined) inventory.name = data.name;
  if (data.description !== undefined) inventory.description = data.description;
  await inventory.save();
  return inventory;
}

async function deleteInventory(id) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const inventory = await Inventory.findOne({ _id: id, status: 'active' }).session(session);
      if (!inventory) throw new ApiError(404, 'Inventory not found.');

      // §5.4 delete guard, manual stand-in for ON DELETE RESTRICT
      const activeStock = await SubInventory.exists({
        inventoryId: id,
        status: 'active',
        quantity: { $gt: 0 },
      }).session(session);
      if (activeStock) {
        throw new ApiError(409, 'Cannot delete Inventory: active batches still have stock.');
      }

      inventory.status = 'deleted';
      await inventory.save({ session });
      await propagateStale(id, null, 'inventory_archived', session);
      result = inventory;
    });
    return result;
  } finally {
    session.endSession();
  }
}

// ---------------------------------------------------------------------------
// SubInventory (batch)
// ---------------------------------------------------------------------------

async function addSubInventory(inventoryId, data) {
  const session = await mongoose.startSession();
  try {
    let created;
    await session.withTransaction(async () => {
      // §5.1 validate-before-write
      const inventory = await Inventory.findOne({ _id: inventoryId, status: 'active' }).session(
        session
      );
      if (!inventory) throw new ApiError(404, 'Inventory not found or not active.');

      let expired = data.expired ?? null;
      if (inventory.category === 'ingredients') {
        if (!expired) {
          throw new ApiError(400, '`expired` is required for category "ingredients".');
        }
        expired = new Date(expired);
        if (Number.isNaN(expired.getTime())) {
          throw new ApiError(400, '`expired` is not a valid date.');
        }
      } else {
        expired = null; // packaging: forced null regardless of what was sent
      }

      // FIX: data.inDate arrives as a string over JSON — must be cast to a
      // real Date before it reaches generateBatchCode()/formatDateYYMMDD(),
      // which call .getFullYear()/.getMonth()/.getDate() on it directly.
      const inDate = data.inDate ? new Date(data.inDate) : new Date();
      if (Number.isNaN(inDate.getTime())) {
        throw new ApiError(400, '`inDate` is not a valid date.');
      }

      const batchCode = await generateBatchCode(SubInventory, inventory.itemCode, inDate, session);

      const [batch] = await SubInventory.create(
        [
          {
            inventoryId,
            batchCode,
            quantity: data.quantity,
            initialQuantity: data.quantity, // BARU — snapshot, tidak pernah diubah lagi setelah ini
            costPrices: data.costPrices,
            inDate,
            expired,
            status: 'active',
          },
        ],
        { session }
      );

      await HistorySubInventory.create(
        [
          {
            inventoryId,
            subInventoryId: batch._id,
            nameInventory: inventory.name,
            itemCode: inventory.itemCode,
            category: inventory.category,
            unit: inventory.unit,
            batchCode: batch.batchCode,
            quantity: batch.quantity,
            costPrices: batch.costPrices,
            inDate: batch.inDate,
            expired: batch.expired,
          },
        ],
        { session }
      );

      await recomputeInventoryCache(inventoryId, session);
      created = batch;
    });
    return created;
  } finally {
    session.endSession();
  }
}

async function listSubInventory(inventoryId) {
  const inventory = await Inventory.findById(inventoryId);
  if (!inventory) throw new ApiError(404, 'Inventory not found.');

  await lazyExpireBatches(inventoryId, null);

  const batches = await SubInventory.find({
    inventoryId,
    status: { $ne: 'deleted' },
  }).sort({ expired: 1 });

  return batches.map(toBatchDTO);
}

async function deleteSubInventory(id) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const batch = await SubInventory.findOne({ _id: id, status: { $ne: 'deleted' } }).session(
        session
      );
      if (!batch) throw new ApiError(404, 'Batch not found.');

      batch.status = 'deleted';
      await batch.save({ session });
      await recomputeInventoryCache(batch.inventoryId, session);
      await propagateStale(batch.inventoryId, id, 'batch_removed', session);
      result = batch;
    });
    return result;
  } finally {
    session.endSession();
  }
}

async function listHistorySubInventory(query) {
  const { page, limit, inventoryId, from, to } = query;
  const filter = {};
  if (inventoryId) filter.inventoryId = inventoryId;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const [items, total] = await Promise.all([
    HistorySubInventory.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    HistorySubInventory.countDocuments(filter),
  ]);

  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

// ---------------------------------------------------------------------------
// FEFO: check-availability (dry-run) + deduct + deduct/reverse
// Both check-availability and deduct route through planFefoDeduction() —
// see utils/fefo.js — so their logic can never diverge (§4).
// ---------------------------------------------------------------------------

async function checkAvailability(params) {
  let items, availableUntil;

  if (params.items) {
    items = params.items;
    availableUntil = params.availableUntil;
  } else {
    items = [{ inventoryId: params.inventoryId, amountNeeded: params.quantityNeeded }];
    availableUntil = params.availableUntil;
  }

  const results = [];
  for (const { inventoryId, amountNeeded } of items) {
    const inventory = await Inventory.findOne({ _id: inventoryId, status: 'active' });
    if (!inventory) throw new ApiError(404, `Inventory ${inventoryId} not found.`);

    await lazyExpireBatches(inventoryId, null);

    const batches = await SubInventory.find({ inventoryId, status: 'active' }).lean();
    const { plan, sufficient, shortfall, hasUnsafeBatch } = planFefoDeduction(
      batches,
      amountNeeded,
      availableUntil
    );

    results.push({
      inventoryId,
      nameInventory: inventory.name,
      unit: inventory.unit, // BARU
      quantityNeeded: amountNeeded, // ⬅️ disamakan nama dgn checkResultSchema
      sufficient,
      // ⬅️ field baru — total stok aktif SAAT INI, independen dari amountNeeded.
      // Ini yang tadinya saya approksimasi, sekarang dihitung asli dari batches
      // yang sudah kita fetch, jadi gratis (gak query tambahan).
      availableQuantity: batches.reduce((sum, b) => sum + b.quantity, 0),
      shortfall,
      hasUnsafeBatch,
      // ⬅️ dipetakan ke bentuk eligibleBatchSchema, bukan plan mentah
      eligibleBatches: plan.map((step) => ({
        subInventoryId: step.subInventoryId,
        quantityTaken: step.take,
        expired: step.expired,
        batchSafetyStatus: step.batchSafetyStatus,
      })),
    });
  }

  return {
    results,
    overallSufficient: results.every((r) => r.sufficient),
    overallHasUnsafeBatch: results.some((r) => r.hasUnsafeBatch),
  };
}
async function deduct({ items, availableUntil, reference }) {
  const session = await mongoose.startSession();
  try {
    let response;
    await session.withTransaction(async () => {
      const touchedInventoryIds = new Set();
      const usageRows = [];
      const perItemResult = [];

      for (const { inventoryId, amountNeeded } of items) {
        const inventory = await Inventory.findOne({ _id: inventoryId, status: 'active' }).session(
          session
        );
        if (!inventory) throw new ApiError(404, `Inventory ${inventoryId} not found.`);

        const batches = await SubInventory.find({ inventoryId, status: 'active' })
          .session(session)
          .lean();

        const { plan, sufficient, shortfall, hasUnsafeBatch } = planFefoDeduction(
          batches,
          amountNeeded,
          availableUntil
        );

        if (!sufficient) {
          // Whole deduction is atomic across items: any shortfall aborts everything.
          // FIX: opts must be { code, details, isOperational } per ApiError's
          // constructor signature — passing { inventoryId, shortfall } directly
          // silently dropped both fields (destructuring picked up nothing).
          throw new ApiError(
            409,
            `Insufficient stock for Inventory ${inventoryId} (${inventory.name}).`,
            {
              code: 'INSUFFICIENT_STOCK',
              details: { inventoryId, shortfall },
            }
          );
        }

        for (const step of plan) {
          // Atomic conditional update — prevents two concurrent deducts from
          // both succeeding past the same stock (§5.6).
          const updated = await SubInventory.findOneAndUpdate(
            { _id: step.subInventoryId, quantity: { $gte: step.take } },
            [
              {
                $set: {
                  quantity: { $subtract: ['$quantity', step.take] },
                },
              },
              {
                $set: {
                  status: { $cond: [{ $lte: ['$quantity', 0] }, 'depleted', '$status'] },
                },
              },
            ],
            { session, new: true }
          );
          if (!updated) {
            // Someone else drained this batch between the read and now — abort transaction.
            throw new ApiError(
              409,
              `Concurrent stock change detected on batch ${step.batchCode}.`,
              {
                code: 'CONCURRENT_STOCK_CHANGE',
                details: { subInventoryId: step.subInventoryId, batchCode: step.batchCode },
              }
            );
          }

          usageRows.push({
            inventoryId,
            subInventoryId: step.subInventoryId,
            nameInventory: inventory.name,
            batchCode: step.batchCode,
            quantityUsed: step.take,
            costPriceUsed: step.pricePerUnit != null ? step.pricePerUnit * step.take : null, // FIX: proporsional
            reference: reference || null,
            availableUntil: availableUntil || null,
            batchSafetyStatus: step.batchSafetyStatus,
          });
        }

        touchedInventoryIds.add(String(inventoryId));
        perItemResult.push({
          inventoryId,
          nameInventory: inventory.name,
          unit: inventory.unit, // BARU
          quantityNeeded: amountNeeded,
          batches: plan.map((step) => ({
            subInventoryId: step.subInventoryId,
            batchCode: step.batchCode,
            quantityUsed: step.take,
            costPriceUsed: step.pricePerUnit != null ? step.pricePerUnit * step.take : null, // FIX: samain dengan usageRows
            batchSafetyStatus: step.batchSafetyStatus,
            expired: step.expired,
          })),
        });
      }

      const created = await HistoryUsage.insertMany(usageRows, { session });

      for (const invId of touchedInventoryIds) {
        await recomputeInventoryCache(invId, session);
      }

      response = {
        reference: reference || null,
        items: perItemResult,
        historyUsageIds: created.map((r) => r._id),
      };
    });
    return response;
  } finally {
    session.endSession();
  }
}

async function reverseDeduct({ reference }) {
  const session = await mongoose.startSession();
  try {
    let response;
    await session.withTransaction(async () => {
      const rows = await HistoryUsage.find({ reference, isReversed: false }).session(session);
      if (rows.length === 0) {
        throw new ApiError(404, `No un-reversed usage found for reference "${reference}".`, {
          code: 'REFERENCE_NOT_FOUND',
          details: { reference },
        });
      }

      const touchedInventoryIds = new Set();

      for (const row of rows) {
        // Only un-depletes, never un-expires or un-deletes — restore quantity
        // and flip depleted -> active, but leave expired/deleted batches alone.
        await SubInventory.findOneAndUpdate(
          { _id: row.subInventoryId, status: { $in: ['active', 'depleted'] } },
          [
            { $set: { quantity: { $add: ['$quantity', row.quantityUsed] } } },
            {
              $set: { status: { $cond: [{ $eq: ['$status', 'depleted'] }, 'active', '$status'] } },
            },
          ],
          { session }
        );

        row.isReversed = true;
        row.reversedAt = new Date();
        await row.save({ session });

        touchedInventoryIds.add(String(row.inventoryId));
      }

      for (const invId of touchedInventoryIds) {
        await recomputeInventoryCache(invId, session);
      }

      response = { reference, reversedCount: rows.length };
    });
    return response;
  } finally {
    session.endSession();
  }
}

async function listHistoryUsage(query) {
  const { page, limit, inventoryId, from, to } = query;
  const filter = {};
  if (inventoryId) filter.inventoryId = inventoryId;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const [items, total] = await Promise.all([
    HistoryUsage.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    HistoryUsage.countDocuments(filter),
  ]);

  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

module.exports = {
  recomputeInventoryCache,
  lazyExpireBatches,
  createInventory,
  listInventory,
  dropdownInventory,
  getInventoryDetail,
  updateInventory,
  deleteInventory,
  addSubInventory,
  listSubInventory,
  deleteSubInventory,
  listHistorySubInventory,
  checkAvailability,
  deduct,
  reverseDeduct,
  listHistoryUsage,
  toBatchDTO,
};
