const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const inventoryService = require('../services/inventory.service');

const createInventory = asyncHandler(async (req, res) => {
  const inventory = await inventoryService.createInventory(req.body);
  return new ApiResponse(201, inventory, 'Inventory created successfully').send(res);
});

const listInventory = asyncHandler(async (req, res) => {
  const result = await inventoryService.listInventory(req.query);
  return new ApiResponse(200, result, 'Inventory list fetched successfully').send(res);
});

const dropdownInventory = asyncHandler(async (req, res) => {
  const items = await inventoryService.dropdownInventory();
  return new ApiResponse(200, items, 'Inventory dropdown fetched successfully').send(res);
});

const getInventoryDetail = asyncHandler(async (req, res) => {
  const inventory = await inventoryService.getInventoryDetail(req.params.id);
  return new ApiResponse(200, inventory, 'Inventory detail fetched successfully').send(res);
});

const updateInventory = asyncHandler(async (req, res) => {
  const inventory = await inventoryService.updateInventory(req.params.id, req.body);
  return new ApiResponse(200, inventory, 'Inventory updated successfully').send(res);
});

const deleteInventory = asyncHandler(async (req, res) => {
  await inventoryService.deleteInventory(req.params.id);
  return new ApiResponse(200, null, 'Inventory archived.').send(res);
});

const addSubInventory = asyncHandler(async (req, res) => {
  const batch = await inventoryService.addSubInventory(req.params.id, req.body);
  return new ApiResponse(201, batch, 'Sub-inventory batch added successfully').send(res);
});

const listSubInventory = asyncHandler(async (req, res) => {
  const batches = await inventoryService.listSubInventory(req.params.id);
  return new ApiResponse(200, batches, 'Sub-inventory list fetched successfully').send(res);
});

const deleteSubInventory = asyncHandler(async (req, res) => {
  await inventoryService.deleteSubInventory(req.params.id);
  return new ApiResponse(200, null, 'Batch archived.').send(res);
});

const listHistorySubInventory = asyncHandler(async (req, res) => {
  const result = await inventoryService.listHistorySubInventory(req.query);
  return new ApiResponse(200, result, 'Sub-inventory history fetched successfully').send(res);
});

const checkAvailability = asyncHandler(async (req, res) => {
  const result = await inventoryService.checkAvailability(req.body);
  return new ApiResponse(200, result, 'Availability checked successfully').send(res);
});

const deduct = asyncHandler(async (req, res) => {
  const result = await inventoryService.deduct(req.body);
  return new ApiResponse(200, result, 'Inventory deducted successfully').send(res);
});

const reverseDeduct = asyncHandler(async (req, res) => {
  const result = await inventoryService.reverseDeduct(req.body);
  return new ApiResponse(200, result, 'Deduction reversed successfully').send(res);
});

const listHistoryUsage = asyncHandler(async (req, res) => {
  const result = await inventoryService.listHistoryUsage(req.query);
  return new ApiResponse(200, result, 'Usage history fetched successfully').send(res);
});

module.exports = {
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
};
