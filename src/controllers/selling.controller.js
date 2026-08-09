const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const sellingService = require('../services/selling.service');

const getActivePlans = asyncHandler(async (req, res) => {
  const plans = await sellingService.getActivePlans();
  return new ApiResponse(200, plans, 'Daftar plan aktif berhasil diambil').send(res);
});

const createSale = asyncHandler(async (req, res) => {
  const sale = await sellingService.createSale(req.body);
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
