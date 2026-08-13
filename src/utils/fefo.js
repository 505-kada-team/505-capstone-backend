/**
 * Shared FEFO + batchSafetyStatus contract.
 *
 * CRITICAL (per 04-inventory-flow.md §4): check-availability (dry-run) and
 * deduct (real) MUST call this same function. Never reimplement FEFO
 * ordering or safety-status logic separately in the two endpoints.
 */

/**
 * @param {Date|null} expired - batch's expiry date, null for packaging
 * @param {Date|null|undefined} availableUntil - plan's requested end date
 * @returns {'safe'|'unsafe'|null} null = no safety evaluation requested (availableUntil omitted)
 */
function computeBatchSafetyStatus(expired, availableUntil) {
  if (!availableUntil) return null;
  if (expired === null || expired === undefined) return 'safe'; // packaging never expires
  return new Date(expired) >= new Date(availableUntil) ? 'safe' : 'unsafe';
}

/**
 * Plan-independent, per-batch signal (decision #2): a signed integer day
 * count instead of a boolean, so the frontend owns the warning threshold.
 * @param {Date|null} expired
 * @returns {number|null} null for packaging (no expiry). Negative = already expired.
 */
function daysUntilExpiry(expired) {
  if (!expired) return null;
  const diffMs = new Date(expired).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * FEFO always takes soonest-expiring active batch first. No exceptions,
 * no exclusions — an "unsafe" batch is still taken, only labeled.
 * Packaging batches (expired === null) sort last, since they never expire
 * and shouldn't block ingredients from being drawn down first.
 *
 * @param {Array<{_id, batchCode, quantity, costPrices, expired}>} batches - active batches for one Inventory
 * @param {number} amountNeeded
 * @param {Date|null|undefined} availableUntil
 */
function planFefoDeduction(batches, amountNeeded, availableUntil) {
  const sorted = [...batches].sort((a, b) => {
    if (a.expired === null && b.expired === null) return 0;
    if (a.expired === null) return 1;
    if (b.expired === null) return -1;
    return new Date(a.expired) - new Date(b.expired);
  });

  let remaining = amountNeeded;
  const plan = [];

  for (const batch of sorted) {
    if (remaining <= 0) break;
    if (batch.quantity <= 0) continue;
    const take = Math.min(batch.quantity, remaining);

    // pricePerUnit dihitung dari initialQuantity (qty saat beli), BUKAN batch.quantity
    // (sisa saat ini) — supaya harga per unit tidak ikut naik seiring stok berkurang.
    const pricePerUnit =
      batch.initialQuantity > 0 ? batch.costPrices / batch.initialQuantity : null;

    plan.push({
      subInventoryId: batch._id,
      batchCode: batch.batchCode,
      take,
      costPrices: batch.costPrices, // tetap disimpan: total harga borongan batch, untuk referensi/histori
      pricePerUnit, // BARU — harga per unit inventory (kg/liter/pcs) untuk batch spesifik ini
      expired: batch.expired,
      batchSafetyStatus: computeBatchSafetyStatus(batch.expired, availableUntil),
    });
    remaining -= take;
  }

  return {
    plan,
    sufficient: remaining <= 0,
    shortfall: Math.max(remaining, 0),
    hasUnsafeBatch: plan.some((p) => p.batchSafetyStatus === 'unsafe'),
  };
}

module.exports = { computeBatchSafetyStatus, daysUntilExpiry, planFefoDeduction };
