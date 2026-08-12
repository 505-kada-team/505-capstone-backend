const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const menuService = require('../services/menu.service');

const createMenu = asyncHandler(async (req, res) => {
  const menu = await menuService.createMenu(req.body, req.file);
  return new ApiResponse(201, menu, 'Menu berhasil dibuat').send(res);
});

const getMenus = asyncHandler(async (req, res) => {
  const { data, pagination } = await menuService.getMenus(req.query);
  // NOTE: assumes ApiResponse can attach extra top-level fields (here,
  // `pagination`) alongside `data`/`message` — check your ApiResponse
  // implementation and adjust this call if it only supports 3 args.
  return new ApiResponse(200, data, undefined, { pagination }).send(res);
});

const getMenuById = asyncHandler(async (req, res) => {
  const menu = await menuService.getMenuById(req.params.id);
  return new ApiResponse(200, menu).send(res);
});

const updateMenu = asyncHandler(async (req, res) => {
  const { data, affectedDraftPlans } = await menuService.updateMenu(
    req.params.id,
    req.body,
    req.file
  );
  return new ApiResponse(200, data, 'Menu berhasil diperbarui', { affectedDraftPlans }).send(res);
});

const deleteMenu = asyncHandler(async (req, res) => {
  const { data, affectedDraftPlans } = await menuService.deleteMenu(req.params.id);
  return new ApiResponse(200, data, 'Menu berhasil diarsipkan', { affectedDraftPlans }).send(res);
});

const getMenuDropdown = asyncHandler(async (req, res) => {
  const data = await menuService.getMenuDropdown(req.query);
  return new ApiResponse(200, data).send(res);
});

module.exports = {
  createMenu,
  getMenus,
  getMenuById,
  updateMenu,
  deleteMenu,
  getMenuDropdown,
};
