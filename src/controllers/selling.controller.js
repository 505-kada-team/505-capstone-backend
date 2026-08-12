const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const sellingService = require('../services/selling.service');

const getActivePlans = asyncHandler(async (req, res) => {
  const plans = await sellingService.getActivePlans();
  return new ApiResponse(200, plans, 'Daftar plan aktif berhasil diambil').send(res);
});

const createSale = asyncHandler(async (req, res) => {
  // cashierName SENGAJA diambil dari req.user (hasil authenticate()),
  // bukan dari body -- lihat selling.validation.js & keputusan cross-module
  // reconciliation item #12.
  const sale = await sellingService.createSale({
    ...req.body,
    cashierName: req.user.name,
  });
  return new ApiResponse(201, sale, 'Penjualan berhasil dicatat').send(res);
});

const getSaleHistory = asyncHandler(async (req, res) => {
  const history = await sellingService.getSaleHistory(req.query);
  return new ApiResponse(200, history, 'Riwayat penjualan berhasil diambil').send(res);
});

module.exports = {
  getActivePlans,
  createSale,
  getSaleHistory,
};
