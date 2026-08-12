const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const planService = require('../services/plan.service');

// A1
const createPlan = asyncHandler(async (req, res) => {
  const plan = await planService.createPlan(req.body);
  return new ApiResponse(201, plan, 'Plan berhasil dibuat sebagai draft').send(res);
});

// A2
const listPlans = asyncHandler(async (req, res) => {
  const { data, pagination } = await planService.listPlans(req.query);
  return new ApiResponse(200, data, undefined, pagination).send(res);
});

// A3
const getPlanById = asyncHandler(async (req, res) => {
  const plan = await planService.getPlanById(req.params.id);
  return new ApiResponse(200, plan).send(res);
});

// A4
const updatePlan = asyncHandler(async (req, res) => {
  const plan = await planService.updatePlan(req.params.id, req.body);
  return new ApiResponse(
    200,
    plan,
    'Plan berhasil diperbarui, simulasi ketersediaan sudah di-refresh'
  ).send(res);
});

// A5
const refreshAvailability = asyncHandler(async (req, res) => {
  const result = await planService.refreshAvailability(req.params.id);
  return new ApiResponse(200, result).send(res);
});

// A6
const approvePlan = asyncHandler(async (req, res) => {
  const result = await planService.approvePlan(req.params.id, req.user);
  return new ApiResponse(
    200,
    result,
    'Plan disetujui, stok bahan telah dialokasikan dan harga jual dibekukan'
  ).send(res);
});

// A7
const stopPlan = asyncHandler(async (req, res) => {
  const stoppedBy = req.body.stoppedBy || req.user?.name || req.user?.id;
  const result = await planService.stopPlan(req.params.id, { reason: req.body.reason, stoppedBy });
  return new ApiResponse(200, result, 'Plan dihentikan, laporan akhir telah dibuat').send(res);
});

// A8
const cancelPlan = asyncHandler(async (req, res) => {
  const result = await planService.cancelPlan(req.params.id);
  return new ApiResponse(200, result, 'Draft plan berhasil dibatalkan').send(res);
});

// A9
const setDiscount = asyncHandler(async (req, res) => {
  const result = await planService.setDiscount(
    req.params.id,
    req.params.menuId,
    req.body,
    req.user
  );
  return new ApiResponse(200, result, 'Diskon berhasil diterapkan pada menu').send(res);
});

// A10
const removeDiscount = asyncHandler(async (req, res) => {
  const result = await planService.removeDiscount(req.params.id, req.params.menuId);
  return new ApiResponse(200, result, 'Diskon pada menu berhasil dihapus').send(res);
});

module.exports = {
  createPlan,
  listPlans,
  getPlanById,
  updatePlan,
  refreshAvailability,
  approvePlan,
  stopPlan,
  cancelPlan,
  setDiscount,
  removeDiscount,
};
