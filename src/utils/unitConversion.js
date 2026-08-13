const ApiError = require('./ApiError');

const UNIT_TO_BASE = {
  kg: { base: 'gr', factor: 1000 },
  gr: { base: 'gr', factor: 1 },
  liter: { base: 'ml', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  pcs: { base: 'pcs', factor: 1 },
};

/**
 * @param {number|null} pricePerUnit - harga per unit inventory (kg/liter/pcs), bukan raw costPrices
 * @param {string} unit - unit inventory ('kg' | 'gr' | 'liter' | 'ml' | 'pcs')
 */
function toBaseUnitPrice(pricePerUnit, unit) {
  const conv = UNIT_TO_BASE[unit];
  if (!conv) throw new ApiError(500, `Unknown unit "${unit}" in inventory record.`);
  return {
    baseUnit: conv.base,
    pricePerBaseUnit: pricePerUnit != null ? pricePerUnit / conv.factor : null,
  };
}

module.exports = { UNIT_TO_BASE, toBaseUnitPrice };
